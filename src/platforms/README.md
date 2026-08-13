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
  plannedPlatform.ts   helper for not-yet-implemented entries
  index.ts             registers every platform (imported once from main.ts)
  avalanche/           the only fully implemented platform today
  ethereum/            \
  solana/               |  descriptor-only stubs, status: 'planned'
  bitcoin/              |  listed in the UI but not loggable
  robinhood/           /
```

## Current state

**Avalanche is the only implemented platform.** It is also the default
(`DEFAULT_PLATFORM_ID` in `registry.ts`), so with no saved preference the app
behaves exactly as it always has.

The other four are **descriptor-only stubs**: `status: 'planned'`, no access
methods, all capabilities `false`. The registry reports them unavailable and the
picker renders them disabled — there is no code path that logs into one.

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
