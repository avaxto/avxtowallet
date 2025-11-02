import { NetworkConfig } from '@/avalanche-wallet-sdk/Network/types';
import { setRpcNetwork, setRpcNetworkAsync } from '@/avalanche-wallet-sdk/Network/network';
import { emitNetworkChange } from '@/avalanche-wallet-sdk/Network/eventEmitter';
import { bustErc20Cache } from '@/avalanche-wallet-sdk/Asset/Erc20';

export function setNetwork(conf: NetworkConfig) {
    setRpcNetwork(conf);
    emitNetworkChange(conf);
    bustErc20Cache();
}

/**
 * Unlike `setNetwork` this function will fail if the network is not available.
 * @param conf
 */
export async function setNetworkAsync(conf: NetworkConfig) {
    await setRpcNetworkAsync(conf);
    emitNetworkChange(conf);
    bustErc20Cache();
}
