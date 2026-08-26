# Platforms

A **platform** is a source of accounts and assets the wallet can operate on — a
blockchain (Avalanche, Ethereum, Solana, Bitcoin) or an account-based
brokerage/custodial service (e.g. Robinhood).

The goal of this folder is that **adding a platform never requires editing a
feature component**. Views branch on a platform's declared *capabilities*, never
on a platform id or a wallet `type` string.

## Layout

```
platforms/
  types.ts             the Platform / PlatformWallet interfaces
  registry.ts          register + look up platforms
  store.ts             useActivePlatformStore — which platform is active
  theme.ts             applies a platform's interface tint
  plannedPlatform.ts   helper for not-yet-implemented entries
  tokenRegistryHelpers.ts  shared anti-spoofing matching for token registries
  index.ts             registers every platform (imported once from main.ts)
  avalanche/           multi-chain (X/P/C), wraps the existing implementation
  evm/                 every EVM chain — differentiates by network, not platform
  solana/              SOL + SPL, injected and local-key custody
  bitcoin/             descriptor-only stub, status: 'planned'
```

Chain-level support code lives outside this folder, one directory per chain
family: `src/evm/` (network registry, providers, explorers) and `src/solana/`
(clusters, SLIP-0010 derivation, RPC, SPL reads). `platforms/<id>/` holds the
wallet, the session store and the `Platform` object; `src/<family>/` holds the
primitives those are built from.

## Current state

**Avalanche, EVM and Solana are implemented.** Avalanche is the default
(`DEFAULT_PLATFORM_ID` in `registry.ts`), so with no saved preference the app
behaves exactly as it always has.

Bitcoin is a **descriptor-only stub**: `status: 'planned'`, no access methods,
all capabilities `false`, no chains or networks. The registry reports it
unavailable and the picker renders it disabled — there is no code path that
logs into it.

### Chain shape — how X/P features hide themselves

A platform declares its sub-chains via `chains: PlatformChain[]`, each tagged
`kind: 'evm' | 'utxo' | 'staking' | 'solana'`. Avalanche declares three
(X = utxo, P = staking, C = evm); EVM declares one evm chain; Solana declares
one `solana` chain.

`solana` is deliberately its own kind rather than being folded into `evm`.
Nothing gates *on* `solana` — the point is that it matches none of the other
kinds, so every X/P, staking, cross-chain and EVM-only surface hides itself
without any view naming Solana.

Views gate on that shape — `platformStore.isMultiChain`,
`platformStore.hasChainKind('staking')`, `platformStore.can('crossChain')` —
**never on a platform id**. That is what makes EVM and Solana render as plain
single-chain wallets (no cross-chain, earn, addresses, wizard or advanced nav)
without any view naming them.

Two views still branch on `activePlatformId` (`Portfolio.vue`, `Transfer.vue`)
because each platform needs a genuinely different asset list and send form —
Avalanche's X/P assets, EVM's multi-network ERC-20 scan, Solana's SPL token
accounts. Those are component *choices*, not capability gates; everything that
can be expressed as a capability still is.

### Switching platforms starts from zero

`setActivePlatform()` logs the current platform out, persists the new id, clears
the stored wallet, and then **hard-reloads the app**. The reload is deliberate:
platform state lives across many long-lived stores and module-level SDK
singletons written assuming one platform per page load. Clearing them piecemeal
risks one being missed and showing another chain's data — strictly worse than a
reload.

### Theming

A platform may declare `descriptor.theme` (`accent` / `onAccent` / `logo`).
`theme.ts` writes those into CSS custom properties on activation, and
`components/misc/PlatformLogo.vue` renders the wordmark as inline SVG so it can
be tinted exactly (Robinhood: `rgb(204, 255, 0)`). Backgrounds and body text are
deliberately **not** overridable, so a platform theme can never make the
interface unreadable.

### Important: this is a boundary, not a finished migration

`platforms/avalanche/index.ts` **wraps** the existing Avalanche implementation
(`js/wallets/*`, the Pinia stores, and the vendored `avalanche` /
`avalanche-wallet-sdk` SDKs) instead of relocating it.

That is deliberate. Roughly 200 files import those modules directly:

| import | files |
|---|---|
| `@/avalanche` (vendored AvalancheJS) | 202 |
| `avalanche-wallet-sdk` | 94 |
| `js/wallets` | 74 |
| `@/AVA` | 57 |

Physically moving them would be a mechanical rename across the whole codebase
with real regression risk and no behavioural benefit. Instead this adapter is
the one file that *knows* those modules exist. Everything reached through the
`Platform` interface is chain-neutral, so Avalanche-specific code can migrate
behind the boundary incrementally (a strangler-fig migration).

The vendored SDK folders (`src/avalanche`, `src/avalanche-wallet-sdk`) are
third-party library code, not project code, and stay where they are.

So: **the abstraction is real and wired up end to end, but the ~200 existing
Avalanche call sites have not been migrated to it yet.** `PlatformWallet.native`
is the documented escape hatch they use in the meantime.

## Adding a platform

1. Create `platforms/<id>/index.ts` exporting a `Platform`.
2. Register it in `platforms/index.ts`.

That's it — the picker, the login screen and capability gating all read from the
registry.

```ts
import type { Platform } from '../types'

export const myPlatform: Platform = {
    descriptor: {
        id: 'myplatform',
        name: 'My Platform',
        symbol: 'MYP',
        status: 'available',
    },
    capabilities: {
        send: true,
        receive: true,
        stake: false,
        swap: false,
        crossChain: false,
        signMessage: true,
        collectibles: false,
        offlineSigning: false,
    },
    accessMethods: [
        { id: 'mnemonic', label: 'Recovery Phrase', kind: 'route', route: '/access/mnemonic' },
    ],
    getActiveWallet: () => currentWallet,
    logout: async () => { /* clear session */ },
}
```

### Access methods

`accessMethods` drives the login screen, so a platform declares its own login
paths rather than the view hardcoding them. Three kinds:

- `route` — navigate to a view (`route: '/access/mnemonic'`)
- `action` — run `run()` in place (connecting to a browser extension)
- `component` — a bespoke multi-step flow owns the button (`component: 'LedgerButton'`,
  which `views/access/Menu.vue` maps to a component it imports)

Set `labelKey` to an i18n key to stay localisable; `label` is the fallback.

### Custody

Nothing in the interface assumes the app holds a private key. A platform may
sign locally, delegate to a device or extension, or just call a remote API with
a session token — which is why `robinhood/` fits the same interface. If you
build a custodial platform, the UI must say plainly that funds are custodial.

## Gotchas

- **`useActivePlatformStore` is not `usePlatformStore`.** The latter already
  exists (`@/stores/platform`) and is Avalanche's **P-Chain / platformvm** store.
  They are unrelated.
- Registration is explicit, not glob-based, so a half-finished platform folder
  can't accidentally appear in the UI.
- Duplicate ids throw at startup rather than silently shadowing one another.
