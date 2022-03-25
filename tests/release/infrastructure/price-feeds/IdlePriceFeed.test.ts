import type { AddressLike } from '@enzymefinance/ethers';
import { randomAddress } from '@enzymefinance/ethers';
import { IIdleTokenV4, StandardToken } from '@enzymefinance/protocol';
import type { ProtocolDeployment } from '@enzymefinance/testutils';
import { buyShares, createNewFund, deployProtocolFixture, idleLend } from '@enzymefinance/testutils';
import { utils } from 'ethers';

const idleTokenUnit = utils.parseEther('1');
let fork: ProtocolDeployment;

beforeEach(async () => {
  fork = await deployProtocolFixture();
});

describe('constructor', () => {
  it('sets state vars', async () => {
    const idlePriceFeed = fork.deployment.idlePriceFeed;

    // Assert each derivative is properly registered
    for (const idleTokenAddress of Object.values(fork.config.idle) as AddressLike[]) {
      const idleToken = new IIdleTokenV4(idleTokenAddress, provider);

      expect(await idlePriceFeed.isSupportedAsset(idleToken)).toBe(true);
      expect(await idlePriceFeed.getUnderlyingForDerivative(idleToken)).toMatchAddress(await idleToken.token());
    }

    // SingleUnderlyingDerivativeRegistryMixin
    expect(await idlePriceFeed.getFundDeployer()).toMatchAddress(fork.deployment.fundDeployer);
  });
});

describe('addDerivatives', () => {
  // The "happy path" is tested in the constructor() tests

  it('reverts when using an invalid underlying token', async () => {
    const idlePriceFeed = fork.deployment.idlePriceFeed;
    const idleToken = new IIdleTokenV4(fork.config.idle.bestYieldIdleDai, provider);

    // De-register valid idleToken
    await idlePriceFeed.removeDerivatives([idleToken]);
    expect(await idlePriceFeed.isSupportedAsset(idleToken)).toBe(false);

    await expect(idlePriceFeed.addDerivatives([idleToken], [randomAddress()])).rejects.toBeRevertedWith(
      'Invalid underlying for IdleToken',
    );
  });

  it('reverts when adding an invalid idleToken', async () => {
    await expect(
      fork.deployment.idlePriceFeed.addDerivatives([randomAddress()], [randomAddress()]),
    ).rejects.toBeReverted();
  });
});

describe('calcUnderlyingValues', () => {
  it('returns the correct rate for underlying token (18-decimal underlying)', async () => {
    const idlePriceFeed = fork.deployment.idlePriceFeed;
    const idleToken = new IIdleTokenV4(fork.config.idle.bestYieldIdleDai, provider);
    const underlying = new StandardToken(await idleToken.token(), provider);

    expect(await underlying.decimals()).toEqBigNumber(18);

    const feedRate = await idlePriceFeed.calcUnderlyingValues.args(idleToken, idleTokenUnit).call();
    const expectedRateAmount = idleTokenUnit.mul(await idleToken.tokenPrice()).div(idleTokenUnit);

    expect(feedRate.underlyingAmounts_[0]).toEqBigNumber(expectedRateAmount);
    expect(feedRate.underlyings_[0]).toMatchAddress(underlying);
  });

  it('returns the correct rate for underlying token (non 18-decimal underlying)', async () => {
    const idlePriceFeed = fork.deployment.idlePriceFeed;
    const idleToken = new IIdleTokenV4(fork.config.idle.bestYieldIdleUsdt, provider);
    const underlying = new StandardToken(await idleToken.token(), provider);

    expect(await underlying.decimals()).not.toEqBigNumber(18);

    const feedRate = await idlePriceFeed.calcUnderlyingValues.args(idleToken, idleTokenUnit).call();
    const expectedRateAmount = idleTokenUnit.mul(await idleToken.tokenPrice()).div(idleTokenUnit);

    expect(feedRate.underlyingAmounts_[0]).toEqBigNumber(expectedRateAmount);
    expect(feedRate.underlyings_[0]).toMatchAddress(underlying);
  });
});

describe('isSupportedAsset', () => {
  it('returns false for a random asset', async () => {
    const idlePriceFeed = fork.deployment.idlePriceFeed;

    expect(await idlePriceFeed.isSupportedAsset(randomAddress())).toBe(false);
  });

  it('returns true for an idleToken', async () => {
    const idlePriceFeed = fork.deployment.idlePriceFeed;

    expect(await idlePriceFeed.isSupportedAsset(fork.config.idle.bestYieldIdleDai)).toBe(true);
  });
});

describe('expected values', () => {
  it('returns the expected value from the valueInterpreter (18-decimal underlying)', async () => {
    const valueInterpreter = fork.deployment.valueInterpreter;
    const idleDai = new StandardToken(fork.config.idle.bestYieldIdleDai, provider);
    const dai = new StandardToken(fork.config.primitives.dai, provider);

    expect(await dai.decimals()).toEqBigNumber(18);

    const canonicalAssetValue = await valueInterpreter.calcCanonicalAssetValue.args(idleDai, idleTokenUnit, dai).call();

    // Value should be a small percentage above 1 unit of the underlying
    expect(canonicalAssetValue).toBeAroundBigNumber('1055046802123867539', '0.03');
  });

  it('returns the expected value from the valueInterpreter (non 18-decimal underlying)', async () => {
    const valueInterpreter = fork.deployment.valueInterpreter;
    const idleUsdt = new StandardToken(fork.config.idle.bestYieldIdleUsdt, provider);
    const usdt = new StandardToken(fork.config.primitives.usdt, provider);

    expect(await usdt.decimals()).not.toEqBigNumber(18);

    const canonicalAssetValue = await valueInterpreter.calcCanonicalAssetValue
      .args(idleUsdt, idleTokenUnit, usdt)
      .call();

    // Value should be a small percentage above 1 unit of the underlying
    expect(canonicalAssetValue).toBeAroundBigNumber('1080460');
  });
});

describe('derivative gas costs', () => {
  it('adds to calcGav for weth-denominated fund', async () => {
    const idleToken = new StandardToken(fork.config.idle.bestYieldIdleDai, provider);
    const dai = new StandardToken(fork.config.primitives.dai, whales.dai);
    const weth = new StandardToken(fork.config.weth, whales.weth);
    const denominationAsset = weth;
    const [fundOwner, investor] = fork.accounts;

    const { comptrollerProxy, vaultProxy } = await createNewFund({
      denominationAsset: weth,
      fundDeployer: fork.deployment.fundDeployer,
      fundOwner,
      signer: fundOwner,
    });

    // Buy shares to add denomination asset
    await buyShares({
      buyer: investor,
      comptrollerProxy,
      denominationAsset,
      seedBuyer: true,
    });

    // Calc base cost of calcGav with already tracked assets
    const calcGavBaseGas = (await comptrollerProxy.calcGav()).gasUsed;

    // Seed the fund with dai and use to receive an idleToken balance
    const daiAmount = utils.parseEther('1');

    await dai.transfer(vaultProxy, daiAmount);
    await idleLend({
      comptrollerProxy,
      fundOwner,
      idleAdapter: fork.deployment.idleAdapter,
      idleToken,
      integrationManager: fork.deployment.integrationManager,
      outgoingUnderlyingAmount: daiAmount,
    });

    // Get the calcGav() cost including the idleToken
    const calcGavWithToken = await comptrollerProxy.calcGav();

    // Assert gas
    expect(calcGavWithToken).toCostAround(calcGavBaseGas.add(147109));
  });
});
