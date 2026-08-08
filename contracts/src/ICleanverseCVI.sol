// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ICleanverseCVI - Cleanverse Verified Identity interface
/// @notice Used to check on-chain KYB status bound to a wallet
interface ICleanverseCVI {
    function isVerified(address account) external view returns (bool);
}
