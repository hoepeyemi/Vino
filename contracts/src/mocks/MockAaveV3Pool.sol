// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../AaveV3YieldSource.sol";

contract MockAToken is ERC20, Ownable {
    address public immutable pool;

    constructor(string memory name_, string memory symbol_, address pool_) ERC20(name_, symbol_) Ownable(msg.sender) {
        require(pool_ != address(0), "Invalid pool address");
        pool = pool_;
    }

    modifier onlyPool() {
        require(msg.sender == pool, "Not pool");
        _;
    }

    function mint(address to, uint256 amount) external onlyPool {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyPool {
        _burn(from, amount);
    }
}

contract MockAaveV3Pool is Ownable {
    using SafeERC20 for IERC20;

    struct ReserveState {
        address asset;
        address aTokenAddress;
        uint128 currentLiquidityRate;
        bool supported;
    }

    mapping(address => ReserveState) private reserves;

    event AssetRegistered(address indexed asset, address indexed aTokenAddress, uint128 liquidityRate);
    event LiquidityRateUpdated(address indexed asset, uint128 liquidityRate);

    constructor() Ownable(msg.sender) {}

    function registerAsset(
        address asset,
        string calldata aTokenName,
        string calldata aTokenSymbol,
        uint128 liquidityRate
    ) external onlyOwner returns (address aTokenAddress) {
        require(asset != address(0), "Invalid asset");
        require(!reserves[asset].supported, "Asset already registered");

        MockAToken aToken = new MockAToken(aTokenName, aTokenSymbol, address(this));
        aTokenAddress = address(aToken);

        reserves[asset] = ReserveState({
            asset: asset,
            aTokenAddress: aTokenAddress,
            currentLiquidityRate: liquidityRate,
            supported: true
        });

        emit AssetRegistered(asset, aTokenAddress, liquidityRate);
    }

    function setLiquidityRate(address asset, uint128 liquidityRate) external onlyOwner {
        require(reserves[asset].supported, "Asset not registered");
        reserves[asset].currentLiquidityRate = liquidityRate;
        emit LiquidityRateUpdated(asset, liquidityRate);
    }

    function getAToken(address asset) external view returns (address) {
        return reserves[asset].aTokenAddress;
    }

    function supply(address asset, uint256 amount, address onBehalfOf, uint16) external {
        ReserveState memory reserve = reserves[asset];
        require(reserve.supported, "Asset not supported");
        require(amount > 0, "Zero amount");

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        MockAToken(reserve.aTokenAddress).mint(onBehalfOf, amount);
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256 withdrawn) {
        ReserveState memory reserve = reserves[asset];
        require(reserve.supported, "Asset not supported");

        MockAToken aToken = MockAToken(reserve.aTokenAddress);
        uint256 balance = aToken.balanceOf(msg.sender);
        require(balance > 0, "No balance");

        withdrawn = amount == type(uint256).max ? balance : amount;
        require(withdrawn <= balance, "Insufficient balance");

        aToken.burn(msg.sender, withdrawn);
        IERC20(asset).safeTransfer(to, withdrawn);
    }

    function getReserveData(address asset) external view returns (IAaveV3Pool.ReserveData memory reserveData) {
        ReserveState memory reserve = reserves[asset];
        if (!reserve.supported) {
            return reserveData;
        }

        reserveData.aTokenAddress = reserve.aTokenAddress;
        reserveData.currentLiquidityRate = reserve.currentLiquidityRate;
    }
}
