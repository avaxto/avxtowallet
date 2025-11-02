import util from 'util'
import crypto from 'crypto'
window.crypto = crypto.webcrypto

window.TextEncoder = util.TextEncoder
window.TextDecoder = util.TextDecoder
