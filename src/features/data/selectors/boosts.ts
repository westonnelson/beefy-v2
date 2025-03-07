import type { BeefyState } from '../../../redux-types';
import type { BoostEntity } from '../entities/boost';
import type { ChainEntity } from '../entities/chain';
import type { VaultEntity } from '../entities/vault';
import { getBoostStatusFromContractState } from '../reducers/boosts';
import { selectBoostUserBalanceInToken, selectBoostUserRewardsInToken } from './balance';
import { createCachedSelector } from 're-reselect';
import { BIG_ZERO } from '../../../helpers/big-number';
import { selectVaultActiveMerklBaseZapV3Campaigns } from './rewards';
import type { BeefyOffChainRewardsCampaignType } from '../apis/beefy/beefy-api-types';

export const selectBoostById = createCachedSelector(
  (state: BeefyState) => state.entities.boosts.byId,
  (state: BeefyState, boostId: BoostEntity['id']) => boostId,
  (boostsById, boostId) => {
    const boost = boostsById[boostId];
    if (boost === undefined) {
      throw new Error(`selectBoostById: Unknown boost id ${boostId}`);
    }
    return boost;
  }
)((state: BeefyState, boostId: BoostEntity['id']) => boostId);

export const selectIsBoostActive = (state: BeefyState, boostId: BoostEntity['id']) => {
  const status = getBoostStatusFromContractState(boostId, selectBoostContractState(state, boostId));
  return status === 'active';
};

export const selectIsBoostActiveOrPreStake = (state: BeefyState, boostId: BoostEntity['id']) => {
  const status = getBoostStatusFromContractState(boostId, selectBoostContractState(state, boostId));
  return status === 'active' || status === 'prestake';
};

export const selectBoostsByChainId = createCachedSelector(
  (state: BeefyState, chainId: ChainEntity['id']) =>
    state.entities.boosts.byChainId[chainId]?.allBoostsIds,
  boostsByChain => boostsByChain || []
)((state: BeefyState, chainId: ChainEntity['id']) => chainId);

export const selectIsVaultBoosted = createCachedSelector(
  (state: BeefyState, vaultId: VaultEntity['id']) => selectActiveVaultBoostIds(state, vaultId),
  activeBoostIds => activeBoostIds.length > 0
)((state: BeefyState, vaultId: VaultEntity['id']) => vaultId);

export const selectIsVaultPreStakedOrBoosted = createCachedSelector(
  (state: BeefyState, vaultId: VaultEntity['id']) => selectActiveVaultBoostIds(state, vaultId),
  (state: BeefyState, vaultId: VaultEntity['id']) => selectPreStakeVaultBoostIds(state, vaultId),
  selectVaultActiveMerklBaseZapV3Campaigns,
  (activeBoostIds, prestakeBoostIds, baseActiveMerklCampaigns) =>
    activeBoostIds.length + prestakeBoostIds.length > 0 ||
    (baseActiveMerklCampaigns &&
      baseActiveMerklCampaigns.length > 0 &&
      baseActiveMerklCampaigns.some(c => c.type === 'zap-v3'))
)((state: BeefyState, vaultId: VaultEntity['id']) => vaultId);

export const selectVaultCurrentBoostId = createCachedSelector(
  (state: BeefyState, vaultId: VaultEntity['id']) => selectActiveVaultBoostIds(state, vaultId),
  (state: BeefyState, vaultId: VaultEntity['id']) => selectPreStakeVaultBoostIds(state, vaultId),
  (activeBoostIds, prestakeBoostIds) => {
    if (activeBoostIds.length > 0) {
      return activeBoostIds[0];
    }
    if (prestakeBoostIds.length > 0) {
      return prestakeBoostIds[0];
    }
    return undefined;
  }
)((state: BeefyState, vaultId: VaultEntity['id']) => vaultId);

export const selectVaultCurrentBoostIdWithStatus = createCachedSelector(
  (state: BeefyState, vaultId: VaultEntity['id']) => selectActiveVaultBoostIds(state, vaultId),
  (state: BeefyState, vaultId: VaultEntity['id']) => selectPreStakeVaultBoostIds(state, vaultId),
  (activeBoostIds, prestakeBoostIds): { id: string; status: 'active' | 'prestake' } | undefined => {
    if (activeBoostIds.length > 0) {
      return { id: activeBoostIds[0], status: 'active' };
    }
    if (prestakeBoostIds.length > 0) {
      return { id: prestakeBoostIds[0], status: 'prestake' };
    }
    return undefined;
  }
)((state: BeefyState, vaultId: VaultEntity['id']) => vaultId);

export const selectIsVaultPrestakedBoost = createCachedSelector(
  (state: BeefyState, vaultId: VaultEntity['id']) => selectPreStakeVaultBoostIds(state, vaultId),
  prestakeBoostIds => prestakeBoostIds.length > 0
)((state: BeefyState, vaultId: VaultEntity['id']) => vaultId);

export const selectActiveVaultBoostIds = createCachedSelector(
  (state: BeefyState, vaultId: VaultEntity['id']) =>
    state.entities.boosts.byVaultId[vaultId]?.activeBoostsIds,
  boostIds => boostIds || []
)((state: BeefyState, vaultId: VaultEntity['id']) => vaultId);

export const selectPreStakeVaultBoostIds = createCachedSelector(
  (state: BeefyState, vaultId: VaultEntity['id']) =>
    state.entities.boosts.byVaultId[vaultId]?.prestakeBoostsIds,
  boostIds => boostIds || []
)((state: BeefyState, vaultId: VaultEntity['id']) => vaultId);

export const selectPreStakeOrActiveBoostIds = createCachedSelector(
  (state: BeefyState, vaultId: VaultEntity['id']) => selectActiveVaultBoostIds(state, vaultId),
  (state: BeefyState, vaultId: VaultEntity['id']) => selectPreStakeVaultBoostIds(state, vaultId),
  (activeBoostIds, prestakeBoostIds) => activeBoostIds.concat(prestakeBoostIds)
)((state: BeefyState, vaultId: VaultEntity['id']) => vaultId);

export const selectAllVaultBoostIds = createCachedSelector(
  (state: BeefyState, vaultId: VaultEntity['id']) =>
    state.entities.boosts.byVaultId[vaultId]?.allBoostsIds,
  boostIds => boostIds || []
)((state: BeefyState, vaultId: VaultEntity['id']) => vaultId);

export const selectPastBoostIdsWithUserBalance = (
  state: BeefyState,
  vaultId: VaultEntity['id']
) => {
  if (!state.entities.boosts.byVaultId[vaultId]) {
    return [];
  }

  const vaultBoosts = state.entities.boosts.byVaultId[vaultId];

  const boostIds: string[] = [];
  for (const eolBoostId of vaultBoosts.expiredBoostsIds) {
    const userBalance = selectBoostUserBalanceInToken(state, eolBoostId);
    if (userBalance.gt(0)) {
      boostIds.push(eolBoostId);
      continue;
    }
    const userRewards = selectBoostUserRewardsInToken(state, eolBoostId);
    if (userRewards.gt(0)) {
      boostIds.push(eolBoostId);
    }
  }
  return boostIds;
};

export const selectShouldDisplayVaultBoost = (state: BeefyState, vaultId: VaultEntity['id']) => {
  if (!state.entities.boosts.byVaultId[vaultId]) {
    return false;
  }

  const vaultBoosts = state.entities.boosts.byVaultId[vaultId];

  // has an active boost
  if (vaultBoosts.activeBoostsIds.length > 0) {
    return true;
  }
  // has a prestaking boost
  if (vaultBoosts.prestakeBoostsIds.length > 0) {
    return true;
  }

  // OR, there was an ended boost and user staked into it
  if (selectPastBoostIdsWithUserBalance(state, vaultId).length > 0) {
    return true;
  }

  return false;
};

export const selectVaultsActiveBoostPeriodFinish = (
  state: BeefyState,
  vaultId: BoostEntity['id']
) => {
  const activeBoost = selectVaultCurrentBoostIdWithStatus(state, vaultId);
  const finish = activeBoost ? selectBoostPeriodFinish(state, activeBoost.id) : new Date(0);
  return finish || new Date(0);
};

export const selectBoostPeriodFinish = (state: BeefyState, boostId: BoostEntity['id']) => {
  return state.entities.boosts.contractState[boostId]?.periodFinish || null;
};

export const selectBoostContractState = (state: BeefyState, boostId: BoostEntity['id']) => {
  return state.entities.boosts.contractState[boostId] || { periodFinish: null, isPreStake: true };
};

export const selectUserBalanceOnActiveOrPastBoost = (
  state: BeefyState,
  vaultId: VaultEntity['id']
) => {
  const isBoosted = selectIsVaultPreStakedOrBoosted(state, vaultId);

  const activeBoost = isBoosted
    ? selectBoostById(state, selectPreStakeOrActiveBoostIds(state, vaultId)[0])
    : null;

  const pastBoostsWithUserBalance = selectPastBoostIdsWithUserBalance(state, vaultId).map(
    boostId => {
      return boostId;
    }
  );

  const isBoostedOrHaveBalanceInPastBoost = isBoosted || pastBoostsWithUserBalance.length === 1;

  const boost =
    isBoosted && activeBoost
      ? selectBoostById(state, activeBoost.id)
      : pastBoostsWithUserBalance.length === 1
      ? selectBoostById(state, pastBoostsWithUserBalance[0])
      : null;

  const boostBalance =
    isBoostedOrHaveBalanceInPastBoost && boost
      ? selectBoostUserBalanceInToken(state, boost.id)
      : BIG_ZERO;

  return boostBalance;
};

export const selectUserActiveBoostBalanceInToken = (
  state: BeefyState,
  vaultId: VaultEntity['id'],
  walletAddress?: string
) => {
  const isBoosted = selectIsVaultBoosted(state, vaultId);

  const activeBoost = isBoosted
    ? selectBoostById(state, selectPreStakeOrActiveBoostIds(state, vaultId)[0])
    : null;

  return isBoosted && activeBoost
    ? selectBoostUserBalanceInToken(state, activeBoost.id, walletAddress)
    : BIG_ZERO;
};

export const selectBoostPartnerById = (state: BeefyState, partnerId: string) => {
  return state.entities.boosts.partners.byId[partnerId];
};

export const selectBoostCampaignById = (state: BeefyState, campaignId: string) => {
  return state.entities.boosts.campaigns.byId[campaignId];
};

export const selectOffchainBoostCampaignByType = (
  state: BeefyState,
  type: BeefyOffChainRewardsCampaignType | undefined
) => {
  if (type === undefined) {
    return undefined;
  }
  return state.entities.boosts.campaigns.byId[`offchain-${type}`];
};
