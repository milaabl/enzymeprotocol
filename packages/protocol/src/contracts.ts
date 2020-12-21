import { BigNumber, BigNumberish } from 'ethers';
import { contract, Call, Send, Contract, AddressLike } from '@crestproject/crestproject';

// Persistent core
export { Dispatcher } from './codegen/Dispatcher';
export { VaultProxy } from './codegen/VaultProxy';

// Persistent release interfaces
export { IMigrationHookHandler } from './codegen/IMigrationHookHandler';

// Release core
export { FundDeployer } from './codegen/FundDeployer';
export { ComptrollerLib } from './codegen/ComptrollerLib';
export { ComptrollerProxy } from './codegen/ComptrollerProxy';
export { VaultLib } from './codegen/VaultLib';

// Infrastructure
export { ValueInterpreter } from './codegen/ValueInterpreter';

// Extensions
export { IExtension } from './codegen/IExtension';
export { FeeManager } from './codegen/FeeManager';
export { IntegrationManager } from './codegen/IntegrationManager';
export { PolicyManager } from './codegen/PolicyManager';

// Primitive price feeds
export { ChainlinkPriceFeed } from './codegen/ChainlinkPriceFeed';

// Derivative price feeds
export { IDerivativePriceFeed } from './codegen/IDerivativePriceFeed';
export { AggregatedDerivativePriceFeed } from './codegen/AggregatedDerivativePriceFeed';
export { ChaiPriceFeed } from './codegen/ChaiPriceFeed';
export { CompoundPriceFeed } from './codegen/CompoundPriceFeed';
export { UniswapV2PoolPriceFeed } from './codegen/UniswapV2PoolPriceFeed';
export { WdgldPriceFeed } from './codegen/WdgldPriceFeed';
export { SynthetixPriceFeed } from './codegen/SynthetixPriceFeed';

// Integration adapters
export { ChaiAdapter } from './codegen/ChaiAdapter';
export { CompoundAdapter } from './codegen/CompoundAdapter';
export { KyberAdapter } from './codegen/KyberAdapter';
export { ParaSwapAdapter } from './codegen/ParaSwapAdapter';
export { SynthetixAdapter } from './codegen/SynthetixAdapter';
export { TrackedAssetsAdapter } from './codegen/TrackedAssetsAdapter';
export { UniswapV2Adapter } from './codegen/UniswapV2Adapter';
export { ZeroExV2Adapter } from './codegen/ZeroExV2Adapter';

// Fees
export { IFee } from './codegen/IFee';
export { EntranceRateBurnFee } from './codegen/EntranceRateBurnFee';
export { EntranceRateDirectFee } from './codegen/EntranceRateDirectFee';
export { ManagementFee } from './codegen/ManagementFee';
export { PerformanceFee } from './codegen/PerformanceFee';

// Policies
export { IPolicy } from './codegen/IPolicy';
export { AdapterBlacklist } from './codegen/AdapterBlacklist';
export { AdapterWhitelist } from './codegen/AdapterWhitelist';
export { AssetBlacklist } from './codegen/AssetBlacklist';
export { AssetWhitelist } from './codegen/AssetWhitelist';
export { BuySharesCallerWhitelist } from './codegen/BuySharesCallerWhitelist';
export { GuaranteedRedemption } from './codegen/GuaranteedRedemption';
export { MaxConcentration } from './codegen/MaxConcentration';
export { MinMaxInvestment } from './codegen/MinMaxInvestment';
export { InvestorWhitelist } from './codegen/InvestorWhitelist';

// Peripheral
export { AuthUserExecutedSharesRequestorFactory } from './codegen/AuthUserExecutedSharesRequestorFactory';
export { AuthUserExecutedSharesRequestorLib } from './codegen/AuthUserExecutedSharesRequestorLib';
export { AuthUserExecutedSharesRequestorProxy } from './codegen/AuthUserExecutedSharesRequestorProxy';
export { FundActionsWrapper } from './codegen/FundActionsWrapper';

// Mocks
export { MockVaultLib } from './codegen/MockVaultLib';
export { MockChaiIntegratee } from './codegen/MockChaiIntegratee';
export { CentralizedRateProvider } from './codegen/CentralizedRateProvider';
export { MockChaiPriceSource } from './codegen/MockChaiPriceSource';
export { MockDerivativePriceFeed } from './codegen/MockDerivativePriceFeed';
export { MockPrimitivePriceFeed } from './codegen/MockPrimitivePriceFeed';
export { MockCTokenIntegratee } from './codegen/MockCTokenIntegratee';
export { MockGenericAdapter } from './codegen/MockGenericAdapter';
export { MockGenericIntegratee } from './codegen/MockGenericIntegratee';
export { MockKyberIntegratee } from './codegen/MockKyberIntegratee';
export { MockKyberPriceSource } from './codegen/MockKyberPriceSource';
export { MockChainlinkPriceSource } from './codegen/MockChainlinkPriceSource';
export { MockToken } from './codegen/MockToken';
export { MockParaSwapIntegratee } from './codegen/MockParaSwapIntegratee';
export { MockReentrancyToken } from './codegen/MockReentrancyToken';
export { MockSynthetixToken } from './codegen/MockSynthetixToken';
export { MockSynthetixIntegratee } from './codegen/MockSynthetixIntegratee';
export { MockSynthetixPriceSource } from './codegen/MockSynthetixPriceSource';
export { MockZeroExV2Integratee } from './codegen/MockZeroExV2Integratee';
export { MockUniswapV2Integratee } from './codegen/MockUniswapV2Integratee';
export { MockUniswapV2PriceSource } from './codegen/MockUniswapV2PriceSource';
export { WETH } from './codegen/WETH';

// External interfaces
export { IUniswapV2Factory } from './codegen/IUniswapV2Factory';
export { IUniswapV2Pair } from './codegen/IUniswapV2Pair';
export { IKyberNetworkProxy } from './codegen/IKyberNetworkProxy';
export { IMakerDaoPot } from './codegen/IMakerDaoPot';
export { IChainlinkAggregator } from './codegen/IChainlinkAggregator';
export { ICERC20 } from './codegen/ICERC20';
export { ICEther } from './codegen/ICEther';
export { IChai } from './codegen/IChai';
export { ISynthetixAddressResolver } from './codegen/ISynthetixAddressResolver';
export { ISynthetixDelegateApprovals } from './codegen/ISynthetixDelegateApprovals';
export { ISynthetixExchangeRates } from './codegen/ISynthetixExchangeRates';
export { ISynthetixExchanger } from './codegen/ISynthetixExchanger';

// prettier-ignore
export interface StandardToken extends Contract<StandardToken> {
  allowance: Call<(owner: AddressLike, spender: AddressLike) => BigNumber, Contract<any>>
  approve: Send<(spender: AddressLike, amount: BigNumberish) => boolean, Contract<any>>
  balanceOf: Call<(account: AddressLike) => BigNumber, Contract<any>>
  decimals: Call<() => BigNumber, Contract<any>>
  symbol: Call<() => string, Contract<any>>
  totalSupply: Call<() => BigNumber, Contract<any>>
  transfer: Send<(recipient: AddressLike, amount: BigNumberish) => boolean, Contract<any>>
  transferFrom: Send<(sender: AddressLike, recipient: AddressLike, amount: BigNumberish) => boolean, Contract<any>>
}

export const StandardToken = contract<StandardToken>()`
  event Approval(address indexed owner, address indexed spender, uint256 value)
  event Transfer(address indexed from, address indexed to, uint256 value)
  function allowance(address owner, address spender) view returns (uint256)
  function approve(address spender, uint256 amount) returns (bool)
  function balanceOf(address account) view returns (uint256)
  function decimals() view returns (uint8)
  function symbol() view returns (string)
  function totalSupply() view returns (uint256)
  function transfer(address recipient, uint256 amount) returns (bool)
  function transferFrom(address sender, address recipient, uint256 amount) returns (bool)
`;

export interface UniswapV2Router extends Contract<UniswapV2Router> {
  getAmountsOut: Call<(amountIn: BigNumberish, path: AddressLike[]) => BigNumber[], Contract<any>>;
  quote: Call<(amountA: BigNumberish, reserveA: BigNumberish, reserveB: BigNumberish) => BigNumber, Contract<any>>;
}

export const UniswapV2Router = contract<UniswapV2Router>()`
  function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])
  function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) pure returns (uint256)
`;
