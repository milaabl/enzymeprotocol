// SPDX-License-Identifier: GPL-3.0

/*
    This file is part of the Enzyme Protocol.

    (c) Enzyme Council <council@enzyme.finance>

    For the full license information, please view the LICENSE
    file that was distributed with this source code.
*/

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../../../interfaces/ICurveAddressProvider.sol";
import "../../../../interfaces/ICurveLiquidityPool.sol";
import "../../../../interfaces/ICurveRegistryMain.sol";
import "../../../../interfaces/ICurveRegistryMetapoolFactory.sol";
import "../../../../utils/FundDeployerOwnerMixin.sol";
import "../IDerivativePriceFeed.sol";

/// @title CurvePriceFeed Contract
/// @author Enzyme Council <security@enzyme.finance>
/// @notice Price feed for Curve pool tokens
contract CurvePriceFeed is IDerivativePriceFeed, FundDeployerOwnerMixin {
    using SafeMath for uint256;

    event DerivativeAdded(address indexed derivative, address indexed pool);

    event DerivativeRemoved(address indexed derivative);

    event InvariantProxyAssetForPoolSet(address indexed pool, address indexed invariantProxyAsset);

    event PoolRemoved(address indexed pool);

    uint256 private constant ADDRESS_PROVIDER_METAPOOL_FACTORY_ID = 3;
    uint256 private constant VIRTUAL_PRICE_UNIT = 10**18;

    ICurveAddressProvider private immutable ADDRESS_PROVIDER_CONTRACT;

    // Both pool tokens and liquidity gauge tokens are treated the same for pricing purposes.
    // We take one asset as representative of the pool's invariant, e.g., WETH for ETH-based pools.
    // Caching invariantProxyAssetDecimals in a packed storage slot
    // removes an additional external call and cold SLOAD operation during value lookups.
    struct InvariantProxyAssetInfo {
        address asset;
        uint8 decimals;
    }

    mapping(address => address) private derivativeToPool;
    mapping(address => InvariantProxyAssetInfo) private poolToInvariantProxyAssetInfo;

    // Not necessary for this contract, but used by Curve liquidity adapters
    mapping(address => address) private poolToLpToken;

    constructor(address _fundDeployer, address _addressProvider)
        public
        FundDeployerOwnerMixin(_fundDeployer)
    {
        ADDRESS_PROVIDER_CONTRACT = ICurveAddressProvider(_addressProvider);
    }

    /// @notice Converts a given amount of a derivative to its underlying asset values
    /// @param _derivative The derivative to convert
    /// @param _derivativeAmount The amount of the derivative to convert
    /// @return underlyings_ The underlying assets for the _derivative
    /// @return underlyingAmounts_ The amount of each underlying asset for the equivalent derivative amount
    function calcUnderlyingValues(address _derivative, uint256 _derivativeAmount)
        public
        override
        returns (address[] memory underlyings_, uint256[] memory underlyingAmounts_)
    {
        address pool = getPoolForDerivative(_derivative);
        require(pool != address(0), "calcUnderlyingValues: _derivative is not supported");

        InvariantProxyAssetInfo memory invariantProxyAssetInfo = getInvariantProxyAssetInfoForPool(
            pool
        );

        underlyings_ = new address[](1);
        underlyings_[0] = invariantProxyAssetInfo.asset;

        underlyingAmounts_ = new uint256[](1);
        if (invariantProxyAssetInfo.decimals == 18) {
            underlyingAmounts_[0] = _derivativeAmount
                .mul(ICurveLiquidityPool(pool).get_virtual_price())
                .div(VIRTUAL_PRICE_UNIT);
        } else {
            underlyingAmounts_[0] = _derivativeAmount
                .mul(ICurveLiquidityPool(pool).get_virtual_price())
                .mul(10**uint256(invariantProxyAssetInfo.decimals))
                .div(VIRTUAL_PRICE_UNIT)
                .div(VIRTUAL_PRICE_UNIT);
        }

        return (underlyings_, underlyingAmounts_);
    }

    /// @notice Checks if an asset is supported by the price feed
    /// @param _asset The asset to check
    /// @return isSupported_ True if the asset is supported
    function isSupportedAsset(address _asset) public view override returns (bool isSupported_) {
        return getPoolForDerivative(_asset) != address(0);
    }

    //////////////////////////
    // DERIVATIVES REGISTRY //
    //////////////////////////

    // addPools() is the primary action to add validated lpTokens and gaugeTokens as derivatives.
    // addGaugeTokens() can be used to add validated gauge tokens for an already-registered pool.
    // addPoolsWithoutValidation() and addGaugeTokensWithoutValidation() can be used as overrides.
    // It is possible to remove all pool data and derivatives (separately).
    // It is possible to update the invariant proxy asset for any pool.

    /// @notice Adds validated gaugeTokens to the price feed
    /// @param _gaugeTokens The ordered gauge tokens
    /// @param _pools The ordered pools corresponding to _gaugeTokens
    /// @dev All params are corresponding, equal length arrays.
    /// _pools must already have been added via an addPools~() function
    function addGaugeTokens(address[] calldata _gaugeTokens, address[] calldata _pools)
        external
        onlyFundDeployerOwner
    {
        ICurveRegistryMain registryContract = __getRegistryMainContract();
        ICurveRegistryMetapoolFactory factoryContract = __getRegistryMetapoolFactoryContract();

        for (uint256 i; i < _gaugeTokens.length; i++) {
            if (factoryContract.get_gauge(_pools[i]) != _gaugeTokens[i]) {
                __validateGaugeMainRegistry(_gaugeTokens[i], _pools[i], registryContract);
            }
        }

        __addGaugeTokens(_gaugeTokens, _pools);
    }

    /// @notice Adds unvalidated gaugeTokens to the price feed
    /// @param _gaugeTokens The ordered gauge tokens
    /// @param _pools The ordered pools corresponding to _gaugeTokens
    /// @dev Should only be used if something is incorrectly failing in the registry validation,
    /// or if gauge tokens exist outside of the registries supported by this price feed,
    /// e.g., a wrapper for non-tokenized gauges.
    /// All params are corresponding, equal length arrays.
    /// _pools must already have been added via an addPools~() function.
    function addGaugeTokensWithoutValidation(
        address[] calldata _gaugeTokens,
        address[] calldata _pools
    ) external onlyFundDeployerOwner {
        __addGaugeTokens(_gaugeTokens, _pools);
    }

    /// @notice Adds validated Curve pool info, lpTokens, and gaugeTokens to the price feed
    /// @param _pools The ordered Curve pools
    /// @param _invariantProxyAssets The ordered invariant proxy assets corresponding to _pools,
    /// e.g., WETH for ETH-based pools
    /// @param _lpTokens The ordered lpToken corresponding to _pools
    /// @param _gaugeTokens The ordered gauge token corresponding to _pools
    /// @dev All params are corresponding, equal length arrays.
    /// address(0) can be used for any _gaugeTokens index to omit the gauge (e.g., no gauge token exists).
    /// _lpTokens is not technically necessary since it is knowable from a Curve registry,
    /// but it's better to use Curve's upgradable contracts as an input validation rather than fully-trusted.
    function addPools(
        address[] calldata _pools,
        address[] calldata _invariantProxyAssets,
        address[] calldata _lpTokens,
        address[] calldata _gaugeTokens
    ) external onlyFundDeployerOwner {
        ICurveRegistryMain registryContract = __getRegistryMainContract();
        ICurveRegistryMetapoolFactory factoryContract = __getRegistryMetapoolFactoryContract();

        for (uint256 i; i < _pools.length; i++) {
            // Validate the lpToken and gauge token based on registry
            if (_lpTokens[i] == registryContract.get_lp_token(_pools[i])) {
                // Main registry

                if (_gaugeTokens[i] != address(0)) {
                    __validateGaugeMainRegistry(_gaugeTokens[i], _pools[i], registryContract);
                }
            } else if (_lpTokens[i] == _pools[i] && factoryContract.get_n_coins(_pools[i]) > 0) {
                // Metapool factory registry
                // lpToken and pool are the same address
                // get_n_coins() is arbitrarily used to validate the pool is on this registry

                if (_gaugeTokens[i] != address(0)) {
                    __validateGaugeMetapoolFactoryRegistry(
                        _gaugeTokens[i],
                        _pools[i],
                        factoryContract
                    );
                }
            } else {
                revert("addPools: Invalid inputs");
            }
        }

        __addPools(_pools, _invariantProxyAssets, _lpTokens, _gaugeTokens);
    }

    /// @notice Adds unvalidated Curve pool info, lpTokens, and gaugeTokens to the price feed
    /// @param _pools The ordered Curve pools
    /// @param _invariantProxyAssets The ordered invariant proxy assets corresponding to _pools,
    /// e.g., WETH for ETH-based pools
    /// @param _lpTokens The ordered lpToken corresponding to _pools
    /// @param _gaugeTokens The ordered gauge token corresponding to _pools
    /// @dev Should only be used if something is incorrectly failing in the registry validation,
    /// or if pools exist outside of the registries supported by this price feed.
    /// All params are corresponding, equal length arrays.
    /// address(0) can be used for any _gaugeTokens index to omit the gauge (e.g., no gauge token exists).
    function addPoolsWithoutValidation(
        address[] calldata _pools,
        address[] calldata _invariantProxyAssets,
        address[] calldata _lpTokens,
        address[] calldata _gaugeTokens
    ) external onlyFundDeployerOwner {
        __addPools(_pools, _invariantProxyAssets, _lpTokens, _gaugeTokens);
    }

    /// @notice Removes derivatives from the price feed
    /// @param _derivatives The derivatives to remove
    /// @dev Unlikely to be needed, just in case of bad storage entry.
    /// Can remove both lpToken and gaugeToken from derivatives list,
    /// but does not remove lpToken from pool info cache.
    function removeDerivatives(address[] calldata _derivatives) external onlyFundDeployerOwner {
        for (uint256 i; i < _derivatives.length; i++) {
            delete derivativeToPool[_derivatives[i]];

            emit DerivativeRemoved(_derivatives[i]);
        }
    }

    /// @notice Removes pools from the price feed
    /// @param _pools The pools to remove
    /// @dev Unlikely to be needed, just in case of bad storage entry.
    /// Does not remove lpToken nor gauge tokens from derivatives list.
    function removePools(address[] calldata _pools) external onlyFundDeployerOwner {
        for (uint256 i; i < _pools.length; i++) {
            delete poolToInvariantProxyAssetInfo[_pools[i]];
            delete poolToLpToken[_pools[i]];

            emit PoolRemoved(_pools[i]);
        }
    }

    /// @notice Updates the invariant proxy assets for the given pools
    /// @param _pools The ordered pools
    /// @param _invariantProxyAssets The ordered invariant asset proxy assets
    function updateInvariantProxyAssets(
        address[] calldata _pools,
        address[] calldata _invariantProxyAssets
    ) external onlyFundDeployerOwner {
        require(
            _pools.length == _invariantProxyAssets.length,
            "updateInvariantProxyAssets: Unequal arrays"
        );

        for (uint256 i; i < _pools.length; i++) {
            __setInvariantProxyAssetForPool(_pools[i], _invariantProxyAssets[i]);
        }
    }

    // PRIVATE FUNCTIONS

    /// @dev Helper to add a derivative to the price feed
    function __addDerivative(address _derivative, address _pool) private {
        require(
            getPoolForDerivative(_derivative) == address(0),
            "__addDerivative: Already exists"
        );

        derivativeToPool[_derivative] = _pool;

        emit DerivativeAdded(_derivative, _pool);
    }

    /// @dev Helper for common logic in addGauges~() functions
    function __addGaugeTokens(address[] calldata _gaugeTokens, address[] calldata _pools) private {
        require(_gaugeTokens.length == _pools.length, "__addGaugeTokens: Unequal arrays");

        for (uint256 i; i < _gaugeTokens.length; i++) {
            require(
                getLpTokenForPool(_pools[i]) != address(0),
                "__addGaugeTokens: Pool not registered"
            );
            // Not-yet-registered _gaugeTokens[i] tested in __addDerivative()

            __addDerivative(_gaugeTokens[i], _pools[i]);
        }
    }

    /// @dev Helper for common logic in addPools~() functions
    function __addPools(
        address[] calldata _pools,
        address[] calldata _invariantProxyAssets,
        address[] calldata _lpTokens,
        address[] calldata _gaugeTokens
    ) private {
        require(
            _pools.length == _invariantProxyAssets.length &&
                _pools.length == _lpTokens.length &&
                _pools.length == _gaugeTokens.length,
            "__addPools: Unequal arrays"
        );

        for (uint256 i; i < _pools.length; i++) {
            // Redundant for validated addPools()
            require(_lpTokens[i] != address(0), "__addPools: Empty lpToken");
            // Empty _pools[i] reverts during __validatePoolCompatibility
            // Empty _invariantProxyAssets[i] reverts during __setInvariantProxyAssetForPool

            // Validate new pool's compatibility with price feed
            require(getLpTokenForPool(_pools[i]) == address(0), "__addPools: Already registered");
            __validatePoolCompatibility(_pools[i]);

            // Register pool info
            __setInvariantProxyAssetForPool(_pools[i], _invariantProxyAssets[i]);
            poolToLpToken[_pools[i]] = _lpTokens[i];

            // Add lpToken and gauge token as derivatives
            __addDerivative(_lpTokens[i], _pools[i]);
            if (_gaugeTokens[i] != address(0)) {
                __addDerivative(_gaugeTokens[i], _pools[i]);
            }
        }
    }

    /// @dev Helper to get the main Curve registry contract
    function __getRegistryMainContract() private view returns (ICurveRegistryMain contract_) {
        return ICurveRegistryMain(ADDRESS_PROVIDER_CONTRACT.get_registry());
    }

    /// @dev Helper to get the Curve metapool factory registry contract
    function __getRegistryMetapoolFactoryContract()
        private
        view
        returns (ICurveRegistryMetapoolFactory contract_)
    {
        return
            ICurveRegistryMetapoolFactory(
                ADDRESS_PROVIDER_CONTRACT.get_address(ADDRESS_PROVIDER_METAPOOL_FACTORY_ID)
            );
    }

    /// @dev Helper to set the invariant proxy asset for a given pool
    function __setInvariantProxyAssetForPool(address _pool, address _invariantProxyAsset) private {
        poolToInvariantProxyAssetInfo[_pool] = InvariantProxyAssetInfo({
            asset: _invariantProxyAsset,
            decimals: ERC20(_invariantProxyAsset).decimals()
        });

        emit InvariantProxyAssetForPoolSet(_pool, _invariantProxyAsset);
    }

    /// @dev Helper to validate a gauge on the main Curve registry
    function __validateGaugeMainRegistry(
        address _gauge,
        address _pool,
        ICurveRegistryMain _mainRegistryContract
    ) private view {
        (address[10] memory gauges, ) = _mainRegistryContract.get_gauges(_pool);
        for (uint256 i; i < gauges.length; i++) {
            if (_gauge == gauges[i]) {
                return;
            }
        }

        revert("__validateGaugeMainRegistry: Invalid gauge");
    }

    /// @dev Helper to validate a gauge on the Curve metapool factory registry
    function __validateGaugeMetapoolFactoryRegistry(
        address _gauge,
        address _pool,
        ICurveRegistryMetapoolFactory _metapoolFactoryRegistryContract
    ) private view {
        require(
            _gauge == _metapoolFactoryRegistryContract.get_gauge(_pool),
            "__validateGaugeMetapoolFactoryRegistry: Invalid gauge"
        );
    }

    /// @dev Helper to validate a pool's compatibility with the price feed.
    /// Pool must implement expected get_virtual_price() function.
    function __validatePoolCompatibility(address _pool) private view {
        require(
            ICurveLiquidityPool(_pool).get_virtual_price() > 0,
            "__validatePoolCompatibility: Incompatible"
        );
    }

    ///////////////////
    // STATE GETTERS //
    ///////////////////

    /// @notice Gets the invariant asset proxy info for a given pool
    /// @param _pool The pool
    /// @return assetInfo_ The invariant asset proxy info
    function getInvariantProxyAssetInfoForPool(address _pool)
        public
        view
        returns (InvariantProxyAssetInfo memory assetInfo_)
    {
        return poolToInvariantProxyAssetInfo[_pool];
    }

    /// @notice Gets the lpToken for a given pool
    /// @param _pool The pool
    /// @return lpToken_ The lpToken
    function getLpTokenForPool(address _pool) public view returns (address lpToken_) {
        return poolToLpToken[_pool];
    }

    /// @notice Gets the pool for a given derivative
    /// @param _derivative The derivative
    /// @return pool_ The pool
    function getPoolForDerivative(address _derivative) public view returns (address pool_) {
        return derivativeToPool[_derivative];
    }
}
