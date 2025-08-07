# ACP-62 Implementation Summary

## Overview
This document summarizes the changes made to adapt the Avalanche wallet to ACP-62, which disables legacy `AddValidatorTx` and `AddDelegatorTx` in favor of permissionless staking transactions.

## Key Changes Made

### 1. Core Wallet Logic (`src/js/wallets/AbstractWallet.ts`)
- ✅ Updated `validate()` method to include BLS parameters
- ✅ Updated `delegate()` method for permissionless transactions
- ✅ Added BLS key validation
- ⚠️ **TODO**: Update to actual AvalancheJS permissionless methods when available

```typescript
// New method signature
async validate(
    nodeID: string,
    amt: BN,
    start: Date,
    end: Date,
    delegationFee: number,
    rewardAddress?: string,
    utxos?: PlatformUTXO[],
    blsPublicKey?: string,     // NEW: BLS public key
    blsSignature?: string      // NEW: BLS signature
): Promise<string>
```

### 2. BLS Utilities (`src/helpers/bls_utils.ts`)
- ✅ Created BLS key validation functions
- ✅ Added placeholder BLS key generation
- ✅ Added error constants and helper functions
- ⚠️ **TODO**: Replace placeholder with real BLS cryptography library

### 3. UI Updates (`src/components/wallet/earn/Validate/AddValidator.vue`)
- ✅ Added BLS public key input field
- ✅ Added BLS signature input field
- ✅ Added BLS key generation button
- ✅ Added BLS validation to form validation
- ✅ Updated styling for BLS section
- ✅ Pass BLS parameters to wallet methods

### 4. Transaction Constants (`src/js/TxHelper.ts`)
- ✅ Updated transaction type enums to mark legacy types
- ⚠️ **TODO**: Add new permissionless transaction constants when AvalancheJS supports them

## Required Dependencies

### AvalancheJS Updates
The current AvalancheJS version doesn't yet support:
- `buildAddPermissionlessValidatorTx()`
- `buildAddPermissionlessDelegatorTx()`
- `PlatformVMConstants.ADDPERMISSIONLESSVALIDATORTX`
- `PlatformVMConstants.ADDPERMISSIONLESSDELEGATORTX`

### BLS Cryptography
Recommended libraries:
- `@noble/bls12-381` - Pure TypeScript BLS implementation
- `bls-eth-wasm` - WebAssembly BLS implementation

## Implementation Status

### ✅ Completed
1. UI fields for BLS key input
2. Form validation for BLS keys
3. Placeholder BLS utilities
4. Updated wallet method signatures
5. Error handling and user feedback

### ⚠️ Pending (awaiting library updates)
1. Actual AvalancheJS permissionless function calls
2. Real BLS cryptography implementation
3. Transaction constant updates

### 🔄 Next Steps
1. **Monitor AvalancheJS releases** for ACP-62 support
2. **Implement real BLS cryptography** using a proper library
3. **Test on testnet** once libraries are available
4. **Update documentation** for end users

## User Experience Changes

### Before ACP-62
- Node ID input
- Stake amount
- Duration
- Delegation fee
- Reward address

### After ACP-62
- Node ID input
- Stake amount
- Duration
- Delegation fee
- Reward address
- **NEW: BLS Public Key** (48 bytes)
- **NEW: BLS Signature** (96 bytes)
- **NEW: Generate BLS Keys button**

## Security Considerations

1. **BLS Key Management**: Keys should be generated deterministically from wallet seed
2. **Validation**: All BLS inputs must be validated for correct format
3. **Error Handling**: Clear error messages for invalid BLS data
4. **Backup**: Users should understand BLS keys are derived from their seed

## Testing Strategy

### Unit Tests
- BLS key validation functions
- Wallet method parameter handling
- Form validation logic

### Integration Tests
- End-to-end staking flow with BLS keys
- Error handling for invalid BLS inputs
- Backward compatibility (if supported)

### User Acceptance Tests
- BLS key generation flow
- Manual BLS key entry
- Error message clarity
- Performance with BLS operations

## Rollback Plan

If issues arise:
1. Feature flags can disable BLS UI sections
2. Fallback to legacy methods (until ACP-62 activation)
3. Clear user communication about requirements

## Timeline Considerations

- **ACP-62 Activation**: When activated, legacy transactions will be rejected
- **Library Readiness**: Need updated AvalancheJS and BLS libraries
- **User Education**: Time needed for user adoption of new flow

## Documentation Updates Needed

1. User guide for BLS key requirements
2. Developer documentation for new APIs
3. Migration guide for existing validators
4. FAQ for common BLS-related questions

## Support Considerations

- Users may need help understanding BLS requirements
- Clear error messages for validation failures
- Support documentation for troubleshooting BLS issues
- Backup/recovery procedures for BLS keys
