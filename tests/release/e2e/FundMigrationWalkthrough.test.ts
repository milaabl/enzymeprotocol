import { EthereumTestnetProvider, SignerWithAddress } from '@crestproject/crestproject';
import {
  adapterBlacklistArgs,
  adapterWhitelistArgs,
  assetBlacklistArgs,
  ComptrollerLib,
  entranceRateFeeConfigArgs,
  feeManagerConfigArgs,
  managementFeeConfigArgs,
  maxConcentrationArgs,
  performanceFeeConfigArgs,
  policyManagerConfigArgs,
  StandardToken,
  VaultLib,
} from '@melonproject/protocol';
import {
  addTrackedAssets,
  buyShares,
  createMigratedFundConfig,
  createNewFund,
  defaultForkDeployment,
  Deployment,
  DeploymentHandlers,
  deployRelease,
  ForkReleaseDeploymentConfig,
  redeemShares,
  ReleaseDeploymentConfig,
  ReleaseDeploymentOutput,
} from '@melonproject/testutils';
import { BigNumber, utils } from 'ethers';

export type Snapshot = ReturnType<typeof snapshot> extends Promise<infer T> ? T : never;

async function snapshot(provider: EthereumTestnetProvider) {
  const { accounts, deployment, config } = await defaultForkDeployment(provider);

  return {
    accounts,
    deployment,
    config,
  };
}

describe('Walkthrough a fund migration', () => {
  let config: ForkReleaseDeploymentConfig;
  let deployment: Snapshot['deployment'];

  let manager: SignerWithAddress;
  let investor: SignerWithAddress;
  let comptrollerProxy: ComptrollerLib;
  let vaultProxy: VaultLib;
  let denominationAsset: StandardToken;

  let preMigrationShareBalance: BigNumber;
  let newComptrollerProxy: ComptrollerLib;

  let newRelease: Deployment<DeploymentHandlers<ReleaseDeploymentConfig, ReleaseDeploymentOutput>>;

  beforeAll(async () => {
    const forkSnapshot = await provider.snapshot(snapshot);

    manager = forkSnapshot.accounts[0];
    investor = forkSnapshot.accounts[1];

    deployment = forkSnapshot.deployment;
    config = forkSnapshot.config;
  });

  it('creates a fund', async () => {
    denominationAsset = config.tokens.weth;

    // fees
    const managementFeeSettings = managementFeeConfigArgs(utils.parseEther('0.01'));
    const performanceFeeSettings = performanceFeeConfigArgs({
      rate: utils.parseEther('0.1'),
      period: 365 * 24 * 60 * 60,
    });
    const entranceRateFeeSettings = entranceRateFeeConfigArgs(utils.parseEther('0.05'));

    const feeManagerConfig = feeManagerConfigArgs({
      fees: [deployment.managementFee, deployment.performanceFee, deployment.entranceRateBurnFee],
      settings: [managementFeeSettings, performanceFeeSettings, entranceRateFeeSettings],
    });

    // policies
    const maxConcentrationSettings = maxConcentrationArgs(utils.parseEther('1'));
    const adapterBlacklistSettings = adapterBlacklistArgs([deployment.compoundAdapter]);
    const adapterWhitelistSettings = adapterWhitelistArgs([
      deployment.kyberAdapter,
      deployment.uniswapV2Adapter,
      deployment.trackedAssetsAdapter,
      deployment.chaiAdapter,
    ]);
    const assetBlacklistSettings = assetBlacklistArgs([config.tokens.knc]);

    const policyManagerConfig = policyManagerConfigArgs({
      policies: [
        deployment.maxConcentration,
        deployment.adapterBlacklist,
        deployment.adapterWhitelist,
        deployment.assetBlacklist,
      ],
      settings: [maxConcentrationSettings, adapterBlacklistSettings, adapterWhitelistSettings, assetBlacklistSettings],
    });

    const createFundTx = await createNewFund({
      signer: manager,
      fundDeployer: deployment.fundDeployer,
      fundOwner: manager,
      denominationAsset,
      feeManagerConfig,
      policyManagerConfig,
    });

    expect(createFundTx.receipt).toCostLessThan(`675000`);

    comptrollerProxy = createFundTx.comptrollerProxy;
    vaultProxy = createFundTx.vaultProxy;
  });

  it('buys shares of the fund', async () => {
    const investmentAmount = utils.parseEther('1');
    const minSharesAmount = utils.parseEther('0.00000000001');

    const buySharesArgs = {
      investmentAmount,
      amguValue: investmentAmount,
      minSharesAmount,
    };

    const buySharesTx = await buyShares({
      comptrollerProxy,
      signer: investor,
      buyer: investor,
      denominationAsset,
      ...buySharesArgs,
    });

    expect(buySharesTx).toCostLessThan(312000);

    const rate = utils.parseEther('0.05');
    const rateDivisor = utils.parseEther('1');
    const expectedFee = utils.parseEther('1').mul(rate).div(rateDivisor.add(rate));

    expect(await vaultProxy.balanceOf(investor)).toBeGteBigNumber(utils.parseEther('1').sub(expectedFee));
  });

  xit('seeds the fund with all existing assets', async () => {
    const assets = [
      config.tokens.bat,
      config.tokens.bnb,
      config.tokens.bnt,
      config.tokens.comp,
      config.tokens.link,
      config.tokens.mana,
      config.tokens.ren,
      config.tokens.uni,
      config.tokens.usdc,
      config.tokens.usdt,
      config.tokens.zrx,
    ];
    const compoundAssets = [
      new StandardToken(config.derivatives.compound.cbat, provider),
      new StandardToken(config.derivatives.compound.ccomp, provider),
      new StandardToken(config.derivatives.compound.cdai, provider),
      new StandardToken(config.derivatives.compound.ceth, provider),
      new StandardToken(config.derivatives.compound.crep, provider),
      new StandardToken(config.derivatives.compound.cuni, provider),
    ];

    for (const asset of [...assets, ...compoundAssets]) {
      const decimals = await asset.decimals();
      const transferAmount = utils.parseUnits('1', decimals);

      await asset.connect(manager).transfer.args(vaultProxy, transferAmount).send();

      const balance = await asset.balanceOf(vaultProxy);
      expect(balance).toBeGteBigNumber(transferAmount);
    }

    await addTrackedAssets({
      comptrollerProxy,
      integrationManager: deployment.integrationManager,
      fundOwner: manager,
      trackedAssetsAdapter: deployment.trackedAssetsAdapter,
      incomingAssets: assets,
    });

    await addTrackedAssets({
      comptrollerProxy,
      integrationManager: deployment.integrationManager,
      fundOwner: manager,
      trackedAssetsAdapter: deployment.trackedAssetsAdapter,
      incomingAssets: compoundAssets,
    });
  });

  it('redeems some shares', async () => {
    const balance = await vaultProxy.balanceOf(investor);
    const redeemQuantity = balance.div(2);

    const redeemed = await redeemShares({
      comptrollerProxy,
      signer: investor,
      quantity: redeemQuantity,
    });

    // Bumped from 283825
    expect(redeemed).toCostLessThan(`284000`);

    preMigrationShareBalance = await vaultProxy.balanceOf(investor);
    expect(preMigrationShareBalance).toEqBigNumber(balance.sub(redeemQuantity));
  });

  it('deploys a new release', async () => {
    newRelease = await deployRelease(config);

    await deployment.dispatcher.setCurrentFundDeployer(newRelease.fundDeployer);
  });

  it('creates a migrated fund on the new release', async () => {
    denominationAsset = config.tokens.weth;

    // fees
    const managementFeeSettings = managementFeeConfigArgs(utils.parseEther('0.02'));
    const performanceFeeSettings = performanceFeeConfigArgs({
      rate: utils.parseEther('0.1'),
      period: 30 * 24 * 60 * 60,
    });

    const feeManagerConfig = feeManagerConfigArgs({
      fees: [newRelease.managementFee, newRelease.performanceFee],
      settings: [managementFeeSettings, performanceFeeSettings],
    });

    // policies
    const adapterBlacklistSettings = adapterBlacklistArgs([newRelease.compoundAdapter]);
    const adapterWhitelistSettings = adapterWhitelistArgs([
      newRelease.kyberAdapter,
      newRelease.uniswapV2Adapter,
      newRelease.trackedAssetsAdapter,
      newRelease.chaiAdapter,
    ]);
    const assetBlacklistSettings = assetBlacklistArgs([config.tokens.knc]);

    const policyManagerConfig = policyManagerConfigArgs({
      policies: [newRelease.adapterBlacklist, newRelease.adapterWhitelist, newRelease.assetBlacklist],
      settings: [adapterBlacklistSettings, adapterWhitelistSettings, assetBlacklistSettings],
    });

    const createMigratedFundTx = await createMigratedFundConfig({
      signer: manager,
      fundDeployer: newRelease.fundDeployer,
      denominationAsset,
      feeManagerConfigData: feeManagerConfig,
      policyManagerConfigData: policyManagerConfig,
    });

    expect(createMigratedFundTx.receipt).toCostLessThan(`333000`);

    newComptrollerProxy = createMigratedFundTx.comptrollerProxy;
  });

  it('signals a fund migration', async () => {
    const migrationSignal = await newRelease.fundDeployer
      .connect(manager)
      .signalMigration(vaultProxy, newComptrollerProxy);

    expect(migrationSignal).toCostLessThan(`67000`);

    const getPendingComptrollerProxyCreatorCall = await newRelease.fundDeployer.getPendingComptrollerProxyCreator(
      newComptrollerProxy,
    );

    expect(getPendingComptrollerProxyCreatorCall).toMatchAddress(manager);
  });

  it('executes the fund migration', async () => {
    // Warp to migratable time
    const migrationTimelock = await deployment.dispatcher.getMigrationTimelock();
    await provider.send('evm_increaseTime', [migrationTimelock.toNumber()]);

    await newRelease.fundDeployer.connect(manager).executeMigration(vaultProxy);
  });

  xit('checks the number of shares post migration', async () => {
    const postMigrationShareNumbers = await vaultProxy.balanceOf(investor);

    expect(postMigrationShareNumbers).toEqBigNumber(preMigrationShareBalance);
  });
});
