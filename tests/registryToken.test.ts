import { isRegistryToken, findRegistryEntry } from '@/helpers/registry_token'

const AVXTO = '0xf56CeCc07d97Ac50630022CF84C19e612ae8C93D'
const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

describe('isRegistryToken', () => {
    it('matches a registered contract on its own chain, case-insensitively', () => {
        expect(isRegistryToken(AVXTO, 43114)).toBe(true)
        expect(isRegistryToken(AVXTO.toLowerCase(), 43114)).toBe(true)
        expect(findRegistryEntry(AVXTO, 43114)?.symbol).toBe('AVXTO')
    })

    it('does not match a registered contract on a different chain', () => {
        expect(isRegistryToken(AVXTO, 43113)).toBe(false)
        expect(isRegistryToken(AVXTO, 1)).toBe(false)
    })

    it('does not match unregistered or empty addresses', () => {
        expect(isRegistryToken('0x0000000000000000000000000000000000000001', 43114)).toBe(false)
        expect(isRegistryToken('', 43114)).toBe(false)
        expect(isRegistryToken(undefined, 43114)).toBe(false)
    })

    it('matches Solana mints case-sensitively', () => {
        expect(isRegistryToken(USDC_SOL)).toBe(true)
        expect(isRegistryToken(USDC_SOL.toLowerCase())).toBe(false)
    })
})

describe('USDC registry entry', () => {
    const USDC = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
    it('recognises native USDC on C-Chain mainnet', () => {
        expect(findRegistryEntry(USDC, 43114)?.symbol).toBe('USDC')
        expect(isRegistryToken(USDC, 43113)).toBe(false)
    })
})
