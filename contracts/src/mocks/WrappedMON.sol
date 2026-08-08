// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Simple wrapped MON token for Monad testnet testing.
/// @dev Users deposit native MON and receive an ERC20 balance one-to-one.
contract WrappedMON is ERC20, Ownable {
    constructor() ERC20("Wrapped Monad", "WMON") Ownable(msg.sender) {}

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        require(msg.value > 0, "Zero amount");
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        require(amount > 0, "Zero amount");
        _burn(msg.sender, amount);

        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "Transfer failed");
    }
}
