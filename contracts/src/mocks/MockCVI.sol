// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockCVI - Cleanverse sandbox CVI for Monad testnet
/// @notice Owner-managed allowlist that mimics the Cleanverse Verified Identity contract.
///         In production, replace with the real Cleanverse CVI address from their docs.
contract MockCVI is Ownable {
    mapping(address => bool) private _verified;

    event BusinessVerified(address indexed account);
    event VerificationRevoked(address indexed account);

    constructor() Ownable(msg.sender) {
        _verified[msg.sender] = true;
        emit BusinessVerified(msg.sender);
    }

    function verify(address account) external onlyOwner {
        _verified[account] = true;
        emit BusinessVerified(account);
    }

    function revoke(address account) external onlyOwner {
        _verified[account] = false;
        emit VerificationRevoked(account);
    }

    function isVerified(address account) external view returns (bool) {
        return _verified[account];
    }
}
