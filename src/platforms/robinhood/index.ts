/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { createPlannedPlatform } from '../plannedPlatform'

/**
 * Not yet implemented — and unlike the others, not self-custodial.
 *
 * A brokerage holds the keys, so there is nothing to derive or sign locally:
 * access would be an API session (OAuth or API key), addresses would be account
 * identifiers, and "send" would be an API order rather than a signed
 * transaction. The `Platform` interface is deliberately custody-neutral for
 * exactly this case — see the note at the top of ../types.ts. Anything built
 * here must be explicit in the UI that funds are custodial.
 */
export const robinhoodPlatform = createPlannedPlatform({
    id: 'robinhood',
    name: 'Robinhood',
    symbol: 'HOOD',
    description: 'Custodial brokerage account — funds are held by Robinhood, not by you.',
})

export default robinhoodPlatform
