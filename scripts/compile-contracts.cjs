/*
  Copyright (c) 2026 @REKTBuildr
  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

  Compiles the token-launcher Solidity template into a runtime artifact
  (ABI + creation bytecode) consumed by the in-app token launcher.

  Usage:  node scripts/compile-contracts.cjs
  Output: src/avxto/contracts/AVXTOLaunchToken.json

  Requires the `solc` dev dependency. OpenZeppelin imports are resolved from
  the project's node_modules via solc's import callback.
*/
const fs = require('fs')
const path = require('path')
const solc = require('solc')

const ROOT = path.resolve(__dirname, '..')
const CONTRACT = 'AVXTOLaunchToken.sol'
const SOURCE_PATH = path.join(ROOT, 'contracts', CONTRACT)
const OUT_DIR = path.join(ROOT, 'src', 'avxto', 'contracts')
const OUT_PATH = path.join(OUT_DIR, 'AVXTOLaunchToken.json')

// Resolve `import` statements (e.g. @openzeppelin/...) from node_modules.
function findImports(importPath) {
    try {
        const full = path.join(ROOT, 'node_modules', importPath)
        return { contents: fs.readFileSync(full, 'utf8') }
    } catch (e) {
        return { error: `File not found: ${importPath}` }
    }
}

const input = {
    language: 'Solidity',
    sources: {
        [CONTRACT]: { content: fs.readFileSync(SOURCE_PATH, 'utf8') },
    },
    settings: {
        optimizer: { enabled: true, runs: 200 },
        // 'paris' avoids the PUSH0 opcode for maximum cross-EVM compatibility.
        evmVersion: 'paris',
        outputSelection: {
            '*': { '*': ['abi', 'evm.bytecode.object'] },
        },
    },
}

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }))

const errors = (output.errors || []).filter((e) => e.severity === 'error')
if (errors.length) {
    console.error('Solidity compilation failed:')
    errors.forEach((e) => console.error(e.formattedMessage))
    process.exit(1)
}

const contract = output.contracts[CONTRACT]['AVXTOLaunchToken']
const artifact = {
    contractName: 'AVXTOLaunchToken',
    compiler: solc.version(),
    sourceName: `contracts/${CONTRACT}`,
    abi: contract.abi,
    bytecode: '0x' + contract.evm.bytecode.object,
}

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_PATH, JSON.stringify(artifact, null, 2) + '\n')
console.log(`Wrote ${path.relative(ROOT, OUT_PATH)} (bytecode ${artifact.bytecode.length} chars)`)
