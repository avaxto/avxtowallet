// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AVXTOLaunchToken
 * @dev Parameterized ERC20 template deployed by the AVAX Toolbox token launcher.
 *
 * Built from the standard OpenZeppelin ERC20 libraries:
 *  - ERC20         : the base fungible-token implementation
 *  - ERC20Capped   : enforces an immutable maximum supply
 *  - ERC20Burnable : lets holders burn their own tokens
 *  - Ownable       : the deployer can mint additional supply up to the cap
 *
 * All amounts (initialSupply, cap) are expressed in the token's smallest unit
 * (i.e. already scaled by 10 ** decimals_), so the front end is responsible for
 * the human-readable -> base-unit conversion.
 */
contract AVXTOLaunchToken is ERC20Capped, ERC20Burnable, Ownable {
    uint8 private immutable _decimals;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 initialSupply_,
        uint256 cap_
    ) ERC20(name_, symbol_) ERC20Capped(cap_) {
        require(initialSupply_ <= cap_, "AVXTO: initial supply exceeds cap");
        _decimals = decimals_;
        if (initialSupply_ > 0) {
            _mint(_msgSender(), initialSupply_);
        }
    }

    /// @dev Overrides the default of 18 with the launcher-supplied value.
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /// @dev Owner-only mint, bounded by the cap enforced in ERC20Capped._mint.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @dev Resolve the diamond between ERC20 and ERC20Capped.
    function _mint(address account, uint256 amount)
        internal
        virtual
        override(ERC20, ERC20Capped)
    {
        super._mint(account, amount);
    }
}
