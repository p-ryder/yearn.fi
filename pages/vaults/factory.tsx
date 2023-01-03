import React, {useCallback, useMemo, useState} from 'react';
import {Contract} from 'ethcall';
import {ethers} from 'ethers';
import useSWR from 'swr';
import VaultListFactory from '@vaults/components/list/VaultListFactory';
import {useAsync} from '@vaults/hooks/useAsync';
import VAULT_FACTORY_ABI from '@vaults/utils/abi/vaultFactory.abi';
import {createNewVaultsAndStrategies, estimateGasForCreateNewVaultsAndStrategies} from '@vaults/utils/actions/createVaultFromFactory';
import {VAULT_FACTORY_ADDRESS} from '@vaults/utils/constants';
import Wrapper from '@vaults/Wrapper';
import {Button} from '@yearn-finance/web-lib/components/Button';
import {yToast} from '@yearn-finance/web-lib/components/yToast';
import {useSettings} from '@yearn-finance/web-lib/contexts/useSettings';
import {useWeb3} from '@yearn-finance/web-lib/contexts/useWeb3';
import {useChainID} from '@yearn-finance/web-lib/hooks/useChainID';
import LinkOut  from '@yearn-finance/web-lib/icons/IconLinkOut';
import {toAddress} from '@yearn-finance/web-lib/utils/address';
import {formatAmount} from '@yearn-finance/web-lib/utils/format.number';
import {getProvider, newEthCallProvider} from '@yearn-finance/web-lib/utils/web3/providers';
import {defaultTxStatus, Transaction} from '@yearn-finance/web-lib/utils/web3/transaction';
import {Dropdown} from '@common/components/GaugeDropdown';
import {ImageWithFallback} from '@common/components/ImageWithFallback';
import {CurveContextApp, useCurve} from '@common/contexts/useCurve';

import type {BigNumber} from 'ethers';
import type {NextRouter} from 'next/router';
import type {ReactElement} from 'react';
import type {TAddress} from '@yearn-finance/web-lib/utils/address';
import type {TCurveGauges} from '@common/types/curves';
import type {TDropdownGaugeOption} from '@common/types/types';

const	defaultOption: TDropdownGaugeOption = {
	label: '',
	value: {
		name: '',
		tokenAddress: toAddress(ethers.constants.AddressZero),
		poolAddress: toAddress(ethers.constants.AddressZero),
		gaugeAddress: toAddress(ethers.constants.AddressZero)
	}
};

function	Factory(): ReactElement {
	const {provider, isActive} = useWeb3();
	const {safeChainID} = useChainID();
	const {networks} = useSettings();
	const {gauges} = useCurve();
	const {toast} = yToast();
	const [selectedOption, set_selectedOption] = useState(defaultOption);
	const [hasError, set_hasError] = useState(false);
	const [txStatus, set_txStatus] = useState(defaultTxStatus);

	/* 🔵 - Yearn Finance ******************************************************
	** Only a vault for a gauge with no already created vault can be created.
	** This means we need to check, for all the gauges if we already have an
	** associated vault.
	**************************************************************************/
	const fetchAlreadyCreatedGauges = useCallback(async (): Promise<TCurveGauges[]> => {
		if ((gauges || []).length === 0)  {
			return [];
		}
		const	currentProvider = safeChainID === 1 ? provider || getProvider(1) : getProvider(1);
		const	ethcallProvider = await newEthCallProvider(currentProvider);
		const	curveVaultFactory = new Contract(VAULT_FACTORY_ADDRESS, VAULT_FACTORY_ABI);

		const calls = [];
		for (const gauge of gauges) {
			calls.push(curveVaultFactory.canCreateVaultPermissionlessly(gauge.gauge));
		}
		const	canCreateVaults = await ethcallProvider.tryAll(calls) as boolean[];

		return gauges.filter((_gauge: TCurveGauges, index: number): boolean => canCreateVaults[index]);
	}, [gauges, provider, safeChainID]);
	const	filteredGauges = useAsync(fetchAlreadyCreatedGauges, [], gauges);
	

	/* 🔵 - Yearn Finance ******************************************************
	** We need to create the possible elements for the dropdown by removing all
	** the extra impossible gauges and formating them to the expected 
	** TDropdownGaugeOption type
	**************************************************************************/
	const	gaugesOptions = useMemo((): TDropdownGaugeOption[] => {
		return (
			(filteredGauges || [])
				.filter((item: TCurveGauges): boolean => !item.side_chain && !item.is_killed && !item.factory && item.gauge_controller.get_gauge_weight !== '0')
				.map((gauge: TCurveGauges): TDropdownGaugeOption => ({
					label: gauge.name,
					icon: (
						<ImageWithFallback
							src={`${process.env.BASE_YEARN_ASSETS_URI}/1/${gauge.swap_token}/logo-128.png`}
							alt={gauge.name}
							width={36}
							height={36} />
					),
					value: {
						name: gauge.name,
						tokenAddress: toAddress(gauge.swap_token),
						poolAddress: toAddress(gauge.swap),
						gaugeAddress: toAddress(gauge.gauge)
					}
				})
				));
	}, [filteredGauges]);

	/* 🔵 - Yearn Finance ******************************************************
	** Perform a smartContract call to the ZAP contract to get the expected
	** out for a given in/out pair with a specific amount. This callback is
	** called every 10s or when amount/in or out changes.
	**************************************************************************/
	const fetchEstimate = useCallback(async (inputGaugeAddress: TAddress): Promise<BigNumber> => {
		set_hasError(false);
		try {
			return await estimateGasForCreateNewVaultsAndStrategies(provider, inputGaugeAddress);
		} catch (error) {
			toast({type: 'error', content: ((error as {reason: string})?.reason || '').replace('execution reverted: ', '')});
			set_hasError(true);
			return ethers.constants.Zero;
		}
		//eslint-disable-next-line react-hooks/exhaustive-deps
	}, [provider]); //toast is a false negative error

	const	{data: estimate} = useSWR(
		(!isActive || selectedOption.value.gaugeAddress === toAddress(ethers.constants.AddressZero) || safeChainID !== 1) ?
			null :
			selectedOption.value.gaugeAddress,
		fetchEstimate,
		{refreshInterval: 10000, shouldRetryOnError: false}
	);

	async function	onCreateNewVault(): Promise<void> {
		new Transaction(provider, createNewVaultsAndStrategies, set_txStatus).populate(
			selectedOption.value.gaugeAddress
		).onSuccess(async (): Promise<void> => {
			// mutate();
		}).perform();
	}

	return (
		<section>
			<div className={'mb-4 w-full bg-neutral-100 p-4 md:p-8'}>
				<div aria-label={'new vault card title'} className={'flex flex-col pb-8'}>
					<h2 className={'pb-4 text-3xl font-bold'}>{'Create new Vault'}</h2>
					<div className={'w-full md:w-7/12'}>
						<p>{'Deploy a new auto-compounding Vault for any pool with an existing gauge on curve. User deployed vaults have 0% management fee and a flat 10% performance fee. Permissionless finance just got permissionless-er. To learn more, check our docs.'}</p>
					</div>
				</div>

				<div aria-label={'Available Curve pools'} className={'flex flex-col pb-[52px]'}>
					<div className={'grid grid-cols-1 gap-x-0 gap-y-5 md:grid-cols-6 md:gap-x-8'}>
						<label className={'yearn--input relative z-10 col-span-2'}>
							<p className={'text-neutral-600'}>{'Available Curve pools'}</p>
							<Dropdown
								defaultOption={defaultOption}
								placeholder={'Select Curve Pool'}
								options={gaugesOptions}
								selected={selectedOption}
								onSelect={(option: TDropdownGaugeOption): void => {
									set_selectedOption(option);
								}} />
						</label>

						<div className={'col-span-2 w-full space-y-1'}>
							<p className={'text-neutral-600'}>{'Vault name'}</p>
							<div className={'h-10 bg-neutral-200 p-2 text-neutral-600'}>
								{selectedOption.value.name === '' ? '-' : `Curve ${selectedOption.value.name} Factory yVault`}
							</div>
						</div>

						<div className={'col-span-2 w-full space-y-1'}>
							<p className={'text-neutral-600'}>{'Symbol'}</p>
							<div className={'h-10 bg-neutral-200 p-2 text-neutral-600'}>
								{selectedOption.value.name === '' ? '-' : `yvCurve-${selectedOption.value.name}-f`}
							</div>
						</div>

						<div className={'col-span-3 w-full space-y-1'}>
							<p className={'text-neutral-600'}>{'Pool address'}</p>
							<div className={'flex h-10 flex-row items-center justify-between bg-neutral-200 p-2 font-mono'}>
								{selectedOption.value.poolAddress !== toAddress() ? (
									<>
										<p className={'overflow-hidden text-ellipsis text-neutral-600'}>
											{selectedOption.value.poolAddress}
										</p>
										<a
											href={`${networks[1].explorerBaseURI}/address/${selectedOption.value.poolAddress}`}
											target={'_blank'}
											rel={'noreferrer'}
											className={'ml-4 cursor-pointer text-neutral-900'}>
											<LinkOut className={'h-6 w-6'} />
										</a>
									</>
								) : ''}
							</div>
						</div>
						<div className={'col-span-3 w-full space-y-1'}>
							<p className={'text-neutral-600'}>{'Gauge address'}</p>
							<div className={'flex h-10 flex-row items-center justify-between bg-neutral-200 p-2 font-mono'}>
								{selectedOption.value.gaugeAddress !== toAddress() ? (
									<>
										<p className={'overflow-hidden text-ellipsis text-neutral-600'}>
											{selectedOption.value.gaugeAddress}
										</p>
										<a
											href={`${networks[1].explorerBaseURI}/address/${selectedOption.value.gaugeAddress}`}
											target={'_blank'}
											rel={'noreferrer'}
											className={'ml-4 cursor-pointer text-neutral-900'}>
											<LinkOut className={'h-6 w-6'} />
										</a>
									</>
								) : ''}
							</div>
						</div>

					</div>
				</div>

				<div aria-label={'actions'} className={'flex flex-row items-center space-x-6'}>
					<div>
						<Button
							onClick={onCreateNewVault}
							isBusy={txStatus.pending}
							disabled={!isActive || selectedOption.value.gaugeAddress === toAddress(ethers.constants.AddressZero) || safeChainID !== 1 || hasError}
							className={'w-full'}>
							{'Create new Vault'}
						</Button>
					</div>
					<div>
						<p className={'font-number text-xs'}>
							{`Est. gas ${formatAmount((estimate || ethers.constants.Zero).toNumber(), 0, 0)}`}
						</p>
					</div>
				</div>
			</div>

			<VaultListFactory />
		</section>
	);
}


Factory.getLayout = function getLayout(page: ReactElement, router: NextRouter): ReactElement {
	return (
		<Wrapper router={router}>
			<CurveContextApp>
				{page}
			</CurveContextApp>
		</Wrapper>
	);
};

export default Factory;
