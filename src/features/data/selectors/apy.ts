import type { BeefyState } from '../../../redux-types';
import {
  isCowcentratedGovVault,
  isCowcentratedVault,
  isGovVault,
  isVaultActive,
  type VaultEntity,
} from '../entities/vault';
import {
  selectUserDepositedVaultIds,
  selectUserVaultBalanceInDepositTokenIncludingBoostsBridged,
  selectUserVaultBalanceInUsdIncludingBoostsBridged,
} from './balance';
import {
  selectIsUserBalanceAvailable,
  selectIsVaultApyAvailable,
  selectVaultShouldShowInterest,
} from './data-loader';
import { selectTokenByAddress, selectTokenPriceByAddress } from './tokens';
import { selectVaultById, selectVaultPricePerFullShare } from './vaults';
import { BIG_ZERO } from '../../../helpers/big-number';
import { selectUserActiveBoostBalanceInToken, selectVaultCurrentBoostIdWithStatus } from './boosts';
import type { TotalApy } from '../reducers/apy';
import { isEmpty } from '../../../helpers/utils';
import { selectWalletAddress } from './wallet';
import { BigNumber } from 'bignumber.js';
import {
  isMerklBaseZapV3Campaign,
  type MerklRewardsCampaignWithApr,
  selectVaultActiveMerklCampaigns,
} from './rewards';
import { omit, partition } from 'lodash-es';

const EMPTY_TOTAL_APY: TotalApy = {
  totalApy: 0,
  totalMonthly: 0,
  totalDaily: 0,
};

export const selectVaultTotalApyOrUndefined = (
  state: BeefyState,
  vaultId: VaultEntity['id']
): Readonly<TotalApy> | undefined => {
  return state.biz.apy.totalApy.byVaultId[vaultId] || undefined;
};

export const selectVaultTotalApy = (
  state: BeefyState,
  vaultId: VaultEntity['id']
): Readonly<TotalApy> => {
  return selectVaultTotalApyOrUndefined(state, vaultId) || EMPTY_TOTAL_APY;
};

export const selectDidAPIReturnValuesForVault = (state: BeefyState, vaultId: VaultEntity['id']) => {
  return state.biz.apy.totalApy.byVaultId[vaultId] !== undefined;
};

const EMPTY_GLOBAL_STATS = {
  deposited: 0,
  daily: 0,
  monthly: 0,
  yearly: 0,
  apy: 0,
  depositedVaults: 0,
};

/**
 * Ignores boost component of APY
 */
export const selectUserGlobalStats = (state: BeefyState, address?: string) => {
  const walletAddress = address || selectWalletAddress(state);
  if (!walletAddress) {
    return EMPTY_GLOBAL_STATS;
  }

  if (!selectIsUserBalanceAvailable(state, walletAddress)) {
    return EMPTY_GLOBAL_STATS;
  }

  const userVaultIds = selectUserDepositedVaultIds(state, walletAddress);

  if (userVaultIds.length === 0) {
    return EMPTY_GLOBAL_STATS;
  }

  const newGlobalStats = {
    ...EMPTY_GLOBAL_STATS,
    depositedVaults: userVaultIds.length,
  };

  const userVaults = userVaultIds.map(vaultId => selectVaultById(state, vaultId));

  for (const vault of userVaults) {
    const vaultUsdBalance = selectUserVaultBalanceInUsdIncludingBoostsBridged(
      state,
      vault.id,
      walletAddress
    ).toNumber();

    if (vaultUsdBalance <= 0) {
      continue;
    }

    // Add vault balance to total
    newGlobalStats.deposited += vaultUsdBalance;

    if (!isVaultActive(vault)) {
      continue;
    }

    // Add period totals for each vault
    const apyData = selectVaultTotalApy(state, vault.id);

    if (isEmpty(apyData)) {
      continue;
    }
    const { dailyUsd, monthlyUsd, yearlyUsd } = selectYieldStatsByVaultId(
      state,
      vault.id,
      walletAddress
    );

    newGlobalStats.daily += dailyUsd.toNumber();
    newGlobalStats.monthly += monthlyUsd.toNumber();
    newGlobalStats.yearly += yearlyUsd.toNumber();
  }

  // Skip yield calc if user has no deposits
  if (newGlobalStats.deposited <= 0) {
    return newGlobalStats;
  }

  // Compute average apy
  newGlobalStats.apy = newGlobalStats.yearly / newGlobalStats.deposited;

  return newGlobalStats;
};

export const selectYieldStatsByVaultId = (
  state: BeefyState,
  vaultId: VaultEntity['id'],
  walletAddress?: string
) => {
  const vault = selectVaultById(state, vaultId);
  const oraclePrice = selectTokenPriceByAddress(state, vault.chainId, vault.depositTokenAddress);
  const depositToken = selectTokenByAddress(state, vault.chainId, vault.depositTokenAddress);

  if (!isVaultActive(vault)) {
    return {
      dailyUsd: BIG_ZERO,
      dailyTokens: BIG_ZERO,
      monthlyTokens: BIG_ZERO,
      monthlyUsd: BIG_ZERO,
      yearlyUsd: BIG_ZERO,
      yearlyTokens: BIG_ZERO,
      oraclePrice,
      tokenDecimals: depositToken.decimals,
    };
  }

  const tokenBalance = selectUserVaultBalanceInDepositTokenIncludingBoostsBridged(
    state,
    vault.id,
    walletAddress
  );
  const vaultUsdBalance = tokenBalance.times(oraclePrice);
  const apyData = selectVaultTotalApy(state, vault.id);

  let dailyUsd: BigNumber;
  let dailyTokens: BigNumber;
  let yearlyTokens: BigNumber;
  let yearlyUsd: BigNumber;

  if (isGovVault(vault)) {
    dailyUsd = vaultUsdBalance.times(apyData.totalDaily);
    dailyTokens = tokenBalance.times(apyData.totalDaily);
    yearlyTokens = tokenBalance.times(apyData.totalApy);
    yearlyUsd = vaultUsdBalance.times(apyData.totalApy);
  } else {
    const ppfs = selectVaultPricePerFullShare(state, vaultId);
    const boostBalance = selectUserActiveBoostBalanceInToken(state, vaultId, walletAddress)
      .multipliedBy(ppfs)
      .decimalPlaces(depositToken.decimals, BigNumber.ROUND_FLOOR);
    const boostBalanceUsd = boostBalance.times(oraclePrice);

    const nonBoostBalanceInTokens = tokenBalance.minus(boostBalance);
    const nonBoostBalanceInUsd = nonBoostBalanceInTokens.times(oraclePrice);

    dailyUsd = nonBoostBalanceInUsd.times(apyData.totalDaily);
    dailyTokens = nonBoostBalanceInTokens.times(apyData.totalDaily);
    yearlyTokens = nonBoostBalanceInTokens.times(apyData.totalApy);
    yearlyUsd = nonBoostBalanceInUsd.times(apyData.totalApy);

    if (
      apyData.boostedTotalDaily !== undefined &&
      apyData.boostedTotalApy &&
      boostBalance.gt(BIG_ZERO)
    ) {
      dailyUsd = dailyUsd.plus(boostBalanceUsd.times(apyData.boostedTotalDaily));
      dailyTokens = dailyTokens.plus(boostBalance.times(apyData.boostedTotalDaily));
      yearlyTokens = yearlyTokens.plus(boostBalance.times(apyData.boostedTotalApy));
      yearlyUsd = yearlyUsd.plus(boostBalanceUsd.times(apyData.boostedTotalApy));
    }
  }

  const monthlyTokens = dailyTokens.times(30);
  const monthlyUsd = dailyUsd.times(30);

  return {
    dailyUsd,
    dailyTokens,
    monthlyTokens,
    monthlyUsd,
    yearlyTokens,
    yearlyUsd,
    oraclePrice,
    tokenDecimals: depositToken.decimals,
  };
};

type ApyVaultUIData =
  | { status: 'loading' | 'missing' | 'hidden'; type: 'apy' | 'apr' }
  | {
      status: 'available';
      type: 'apy' | 'apr';
      values: TotalApy;
      boosted: 'active' | 'prestake' | undefined;
    };

function modifyApyForZapV3Campaigns(
  original: TotalApy,
  zapV3Campaigns: MerklRewardsCampaignWithApr[],
  restCampaigns: MerklRewardsCampaignWithApr[]
): TotalApy {
  const newMerklApr = restCampaigns.reduce((acc, c) => acc + c.apr, 0);
  const newMerklDaily = newMerklApr / 365;

  const merklBoostApr = zapV3Campaigns.reduce((acc, c) => acc + c.apr, 0);
  const merklBoostDaily = merklBoostApr / 365;

  const originalMerklApr = original.merklApr || 0;
  const originalMerklDaily = original.merklDaily || 0;

  const modded: TotalApy = {
    ...omit(original, ['merklApr', 'merklDaily']),
    totalApy: original.totalApy - originalMerklApr + newMerklApr,
    totalDaily: original.totalDaily - originalMerklDaily + newMerklDaily,
  };

  if (newMerklApr > 0) {
    modded.merklApr = newMerklApr;
    modded.merklDaily = newMerklDaily;
  }

  if (merklBoostApr > 0) {
    modded.merklBoostApr = merklBoostApr;
    modded.merklBoostDaily = merklBoostDaily;
  }

  if (modded.boostApr || modded.merklBoostApr) {
    modded.boostedTotalApy = modded.totalApy + (modded.boostApr || 0) + (modded.merklBoostApr || 0);
    modded.boostedTotalDaily =
      modded.totalDaily + (modded.boostDaily || 0) + (modded.merklBoostDaily || 0);
  }

  return modded;
}

// TEMP: selector instead of connect/mapStateToProps
export function selectApyVaultUIData(
  state: BeefyState,
  vaultId: VaultEntity['id']
): ApyVaultUIData {
  const vault = selectVaultById(state, vaultId);
  const type: 'apr' | 'apy' = vault.type === 'gov' ? 'apr' : 'apy';

  const shouldShowInterest = selectVaultShouldShowInterest(state, vaultId);
  if (!shouldShowInterest) {
    return { status: 'hidden', type };
  }

  const isLoaded = selectIsVaultApyAvailable(state, vaultId);
  if (!isLoaded) {
    return { status: 'loading', type };
  }

  const exists = selectDidAPIReturnValuesForVault(state, vaultId);
  if (!exists) {
    return { status: 'missing', type };
  }

  const values = selectVaultTotalApy(state, vaultId);
  const boost = selectVaultCurrentBoostIdWithStatus(state, vaultId);
  if (boost) {
    return { status: 'available', type, values, boosted: boost.status };
  }

  const merklCampaigns = selectVaultActiveMerklCampaigns(state, vaultId);
  if (merklCampaigns && merklCampaigns.length > 0) {
    const [zapV3Campaigns, restCampaigns] = partition(merklCampaigns, isMerklBaseZapV3Campaign);
    if (zapV3Campaigns.length > 0) {
      return {
        status: 'available',
        type,
        values: modifyApyForZapV3Campaigns(values, zapV3Campaigns, restCampaigns),
        boosted: 'active',
      };
    }
  }

  if (!isCowcentratedVault(vault) && !isCowcentratedGovVault(vault)) {
    return { status: 'available', type, values, boosted: undefined };
  }

  return {
    status: 'available',
    type: vault.strategyTypeId === 'compounds' ? 'apy' : 'apr',
    values,
    boosted: 'boostedTotalDaily' in values ? 'active' : undefined,
  };
}
