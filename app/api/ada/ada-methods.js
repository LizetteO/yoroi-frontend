// @flow

import _ from 'lodash';
import moment from 'moment';
import BigNumber from 'bignumber.js';
import { Wallet } from 'cardano-crypto';

import type {
  AdaWallet,
  AdaAddress,
  AdaAddresses,
  AdaWalletInitData,
  AdaWalletRecoveryPhraseResponse,
  AdaTransactions,
  AdaTransaction,
  AdaTransactionInputOutput,
  AdaTransactionFee,
} from './types';

import {
  toAdaWallet,
  toAdaAddress
} from './lib/crypto-to-cardano';

import {
  generateWalletSeed,
  isValidAdaMnemonic,
  generateAdaMnemonic,
  getCryptoWalletFromSeed
} from './lib/crypto-wallet';

import {
  getTransactionsHistoryForAddresses,
  getUTXOsForAddresses,
  getUTXOsSumsForAddresses,
  sendTx,
  checkAddressesInUse,
  transactionsLimit,
  addressesLimit
} from './lib/icarus-backend-api';

import {
  mapToList,
  getAddressInHex
} from './lib/utils';

const WALLET_KEY = 'WALLET'; // single wallet atm
const WALLET_SEED_KEY = 'SEED';
const ADDRESSES_KEY = 'ADDRESSES'; // we store a single Map<Address, AdaAddress>
const TX_KEY = 'TXS'; // single txs list atm
const LAST_BLOCK_NUMBER_KEY = 'LAST_BLOCK_NUMBER'; // stores de last block number

export type AdaWalletParams = {
  walletPassword: ?string,
  walletInitData: AdaWalletInitData
};

export type GetAdaHistoryByWalletParams = {
  ca: string,
  walletId: string,
  skip: number,
  limit: number
};

export function isValidAdaAddress(address: String): Promise<boolean> {
  return Promise.resolve(!Wallet.checkAddress(getAddressInHex(address)).failed);
}

export const isValidMnemonic = (phrase: string, numberOfWords: number = 12) =>
  isValidAdaMnemonic(phrase, numberOfWords);

/* Create and save a wallet with your seed, and a SINGLE account with one address */
export async function newAdaWallet({
  walletPassword,
  walletInitData
}: AdaWalletParams): Promise<AdaWallet> {

  const [adaWallet, seed] = createWallet({ walletPassword, walletInitData });
  const cryptoAccount = getSingleCryptoAccount(seed, walletPassword);

  newAdaAddress(cryptoAccount, 'External');

  saveWallet(adaWallet, seed);
  return Promise.resolve(adaWallet);
}

export async function restoreAdaWallet({
  walletPassword,
  walletInitData
}: AdaWalletParams): Promise<AdaWallet> {

  const [adaWallet, seed] = createWallet({ walletPassword, walletInitData });
  const cryptoAccount = getSingleCryptoAccount(seed, walletPassword);

  let addressesToSave = [];
  let fromIndex = 0;
  while (fromIndex >= 0) {
    // TODO: Make offset configurable
    const [newIndex, addressesRecovered] =
      await discoverAddressesFrom(cryptoAccount, 'External', fromIndex, addressesLimit);
    fromIndex = newIndex;
    addressesToSave = addressesToSave.concat(addressesRecovered);
  }
  if (addressesToSave.length !== 0) {
    // TODO: Store all at once
    addressesToSave.forEach((hash, index) => {
      const adaAddress: AdaAddress =
        toAdaAddress(cryptoAccount.account, 'External', index, hash);
      saveAdaAddress(adaAddress);
    });
  } else {
    newAdaAddress(cryptoAccount, 'External');
  }

  saveWallet(adaWallet, seed);
  return Promise.resolve(adaWallet);
}

export const updateAdaWallet = async (): Promise<?AdaWallet> => {
  const persistentWallet = getFromStorage(WALLET_KEY);
  if (!persistentWallet) return Promise.resolve();
  const persistentAddresses: AdaAddresses = getAdaAddresses();
  const addresses = persistentAddresses.map(addr => addr.cadId);
  // Update wallet balance
  const updatedWallet = Object.assign({}, persistentWallet, {
    cwAmount: {
      getCCoin: await getBalance(addresses)
    }
  });
  saveInStorage(WALLET_KEY, updatedWallet);
  await updateAdaTxsHistory(getAdaTransactions(), addresses);
  return updatedWallet;
};

export const getAdaAccountRecoveryPhrase = (): AdaWalletRecoveryPhraseResponse =>
  generateAdaMnemonic();

export const getAdaTxsHistoryByWallet = ({
  walletId,
  skip,
  limit
}: GetAdaHistoryByWalletParams): Promise<AdaTransactions> => {
  const transactions = getAdaTransactions();
  return Promise.resolve([transactions, transactions.length]);
};

export const getAdaTransactionFee = (
  receiver: string,
  amount: string
): Promise<AdaTransactionFee> => {
  const adaWallet = getFromStorage(WALLET_KEY);
  const password = adaWallet.cwHasPassphrase ? 'FakePassword' : undefined;
  return getAdaTransaction(receiver, amount, password)
    .then((result) => {
      // TODO: Improve Js-Wasm-cardano error handling 
      if (result.failed) {
        if (result.msg === 'FeeCalculationError(NotEnoughInput)') {
          throw new Error('not enough money');
        }
      }
      return {
        getCCoin: result.result.fee
      };
    });
};

export const newAdaTransaction = (
  receiver: string,
  amount: string,
  password: ?string
): Promise<AdaTransaction> => {
  return getAdaTransaction(receiver, amount, password)
    .then(({ result: { cbor_encoded_tx } }) => {
      // TODO: Handle Js-Wasm-cardano errors 
      const signedTx = Buffer.from(cbor_encoded_tx).toString('base64');
      return sendTx(signedTx);
    });
};

/* Create and save the next address for the given account */
export function newAdaAddress(cryptoAccount, addressType): AdaAddress {
  const address: AdaAddress = createAdaAddress(cryptoAccount, addressType);
  saveAdaAddress(address);
  return address;
}

export function getAdaAddresses(): AdaAddresses {
  return mapToList(getAdaAddressesMap());
}

export function getWalletSeed() {
  return getFromStorage(WALLET_SEED_KEY);
}

export function getLastBlockNumber() {
  return getFromStorage(LAST_BLOCK_NUMBER_KEY);
}

/**
 * Temporary method helpers
 */

export function getSingleCryptoAccount(seed, walletPassword: ?string) {
  const cryptoWallet = getCryptoWalletFromSeed(seed, walletPassword);
  return createCryptoAccount(cryptoWallet);
}

/**
 * Private method helpers
 */

function saveInStorage(key: string, toSave: any): void {
  localStorage.setItem(key, JSON.stringify(toSave));
}

function getFromStorage(key: string): any {
  const result = localStorage.getItem(key);
  if (result) return JSON.parse(result);
  return undefined;
}

function getAdaTransaction(
  receiver,
  amount,
  password
) {
  const seed = getFromStorage(WALLET_SEED_KEY);
  const cryptoWallet = getCryptoWalletFromSeed(seed, password);
  const addressesMap = getAdaAddressesMap();
  const addresses = mapToList(addressesMap);
  const changeAddr = addresses[0].cadId;
  const outputs = [{ address: receiver, value: parseInt(amount, 10) }];
  return getAllUTXOsForAddresses(addresses)
    .then((senderUtxos) => {
      const inputs = mapUTXOsToInputs(senderUtxos, addressesMap);
      return Wallet.spend(
        cryptoWallet,
        inputs,
        outputs,
        changeAddr
      );
    });
}

async function getAllUTXOsForAddresses(adaAddresses: AdaAddresses) {
  const groupsOfAdaAddresses = _.chunk(adaAddresses, addressesLimit);
  const promises = groupsOfAdaAddresses.map(groupOfAdaAddresses =>
    getUTXOsForAddresses(groupOfAdaAddresses.map(addr => addr.cadId)));
  return Promise.all(promises).then(groupsOfUTXOs =>
    groupsOfUTXOs.reduce((acc, groupOfUTXOs) => acc.concat(groupOfUTXOs), []));
}

function mapTransactions(
  transactions: [],
  accountAddresses,
): Array<AdaTransaction> {
  return transactions.map(tx => {
    const inputs = mapInputOutput(tx.inputs_address, tx.inputs_amount);
    const outputs = mapInputOutput(tx.outputs_address, tx.outputs_amount);
    const { isOutgoing, amount } = spenderData(inputs, outputs, accountAddresses);
    const isPending = tx.block_num === null;
    if (!getLastBlockNumber() || tx.best_block_num > getLastBlockNumber()) {
      saveInStorage(LAST_BLOCK_NUMBER_KEY, tx.best_block_num);
    }
    return {
      ctAmount: {
        getCCoin: amount
      },
      ctBlockNumber: tx.block_num,
      ctId: tx.hash,
      ctInputs: inputs,
      ctIsOutgoing: isOutgoing,
      ctMeta: {
        ctmDate: tx.time,
        ctmDescription: undefined,
        ctmTitle: undefined
      },
      ctOutputs: outputs,
      ctCondition: isPending ? 'CPtxApplying' : 'CPtxInBlocks'
    };
  });
}

function mapInputOutput(addresses, amounts): AdaTransactionInputOutput {
  return addresses.map((address, index) => [address, { getCCoin: amounts[index] }]);
}

function spenderData(txInputs, txOutputs, addresses) {
  const sum = toSum =>
    toSum.reduce(
      ({ totalAmount, count }, [address, { getCCoin }]) => {
        if (addresses.indexOf(address) < 0) return { totalAmount, count };
        return {
          totalAmount: totalAmount.plus(new BigNumber(getCCoin)),
          count: count + 1
        };
      },
      {
        totalAmount: new BigNumber(0),
        count: 0
      }
    );

  const incoming = sum(txOutputs);
  const outgoing = sum(txInputs);

  const isOutgoing = outgoing.totalAmount.greaterThanOrEqualTo(
    incoming.totalAmount
  );

  const isLocal =
    incoming.count === txInputs.length &&
    outgoing.count === txOutputs.length;

  let amount;
  if (isLocal) amount = outgoing.totalAmount;
  else if (isOutgoing) amount = outgoing.totalAmount - incoming.totalAmount;
  else amount = incoming.totalAmount - outgoing.totalAmount;

  return {
    isOutgoing,
    amount
  };
}

async function getBalance(addresses) {
  const groupsOfAddresses = _.chunk(addresses, addressesLimit);
  const promises =
    groupsOfAddresses.map(groupOfAddresses => getUTXOsSumsForAddresses(groupOfAddresses));
  return Promise.all(promises)
  .then(partialAmounts =>
    partialAmounts.reduce(
      (acc, partialAmount) =>
        acc.plus(partialAmount.sum ? new BigNumber(partialAmount.sum) : new BigNumber(0)),
      new BigNumber(0)
    )
  );
}

function mapUTXOsToInputs(utxos, adaAddressesMap) {
  return utxos.map((utxo) => {
    return {
      ptr: {
        index: utxo.tx_index,
        id: utxo.tx_hash
      },
      value: {
        address: utxo.receiver,
        // FIXME: Currently js-wasm-module support Js Number, but amounts could be BigNumber's.
        value: Number(utxo.amount)
      },
      addressing: {
        account: adaAddressesMap[utxo.receiver].account,
        change: adaAddressesMap[utxo.receiver].change,
        index: adaAddressesMap[utxo.receiver].index
      }
    };
  });
}

function createWallet({
  walletPassword,
  walletInitData
}: AdaWalletParams) {
  const adaWallet = toAdaWallet({ walletPassword, walletInitData });
  const mnemonic = walletInitData.cwBackupPhrase.bpToList;
  const seed = generateWalletSeed(mnemonic, walletPassword);
  return [adaWallet, seed];
}

function saveWallet(adaWallet, seed): void {
  saveInStorage(WALLET_KEY, adaWallet);
  saveInStorage(WALLET_SEED_KEY, seed);
}

/* TODO: crypto account should be stored in the localstorage
   in order to avoid insert password each time the user creates a new address
   (implement method: saveCryptoAccount)
*/
function createCryptoAccount(cryptoWallet) {
  const accountIndex = 0; /* Because we only provide a SINGLE account */
  return Wallet.newAccount(cryptoWallet, accountIndex).result.Ok;
}

function createAdaAddress(cryptoAccount, addressType): AdaAddress {
  const addresses = getAdaAddresses();
  const addressIndex = addresses ? addresses.length : 0;
  const { result } = Wallet.generateAddresses(cryptoAccount, addressType, [addressIndex]);
  return toAdaAddress(cryptoAccount.account, addressType, addressIndex, result[0]);
}

function saveAdaAddress(address: AdaAddress): void {
  const addressesMap = getAdaAddressesMap();
  addressesMap[address.cadId] = address;
  saveInStorage(ADDRESSES_KEY, addressesMap);
}

function getAdaTransactions() {
  return getFromStorage(TX_KEY) || [];
}

/* Just return all existing addresses because we are using a SINGLE account */
function getAdaAddressesMap() {
  const addresses = getFromStorage(ADDRESSES_KEY);
  if (!addresses) return {};
  return addresses;
}

async function discoverAddressesFrom(cryptoAccount, addressType, fromIndex, offset) {
  const addressesIndex = _.range(fromIndex, fromIndex + offset);
  const addresses = Wallet.generateAddresses(cryptoAccount, addressType, addressesIndex).result;
  const addressIndexesMap = toAddressIndexesMap(addresses);
  const usedAddresses = await checkAddressesInUse(addresses);
  const lastIndex = usedAddresses.reduce((maxIndex, address) => {
    const index = addressIndexesMap[address];
    if (index && index > maxIndex) {
      return index;
    }
    return maxIndex;
  }, -1);
  if (lastIndex >= 0) {
    const nextIndex = lastIndex + 1;
    return Promise.resolve([nextIndex, addresses.slice(0, nextIndex - fromIndex)]);
  }
  return Promise.resolve([lastIndex, []]);
}

function toAddressIndexesMap(addresses) {
  const map = {};
  addresses.forEach((address, index) => {
    map[address] = index;
  });
  return map;
}

const updateAdaTxsHistory = async (existedTransactions, addresses) => {
  const mostRecentTx = existedTransactions.shift();
  const dateFrom = mostRecentTx ? 
    moment(mostRecentTx.ctMeta.ctmDate) : 
    moment(new Date(0));
  const groupsOfAddresses = _.chunk(addresses, addressesLimit);
  const promises = groupsOfAddresses.map(groupOfAddresses =>
    updateAdaTxsHistoryForGroupOfAddresses([], groupOfAddresses, dateFrom)
  );
  return Promise.all(promises)
  .then((groupsOfTransactions) => {
    const groupedTransactions = groupsOfTransactions
      .reduce((acc, groupOfTransactions) => acc.concat(groupOfTransactions), []);
    const newTransactions = sortTransactionsByDate(groupedTransactions);
    const updatedTransactions = newTransactions.concat(existedTransactions);
    saveInStorage(TX_KEY, updatedTransactions);
    return updatedTransactions;
  });
};

const updateAdaTxsHistoryForGroupOfAddresses = async (
  previousTransactions,
  addresses,
  dateFrom
) => {
  const history = await getTransactionsHistoryForAddresses(addresses, dateFrom);
  if (history.length > 0) {
    const latestTransactions = mapTransactions(history, addresses);
    const transactions = latestTransactions.concat(previousTransactions);
    if (history.length === transactionsLimit) {
      return await 
        updateAdaTxsHistoryForGroupOfAddresses(transactions, addresses, dateFrom);
    }
    return Promise.resolve(transactions);
  }
  return Promise.resolve(previousTransactions);
};

function sortTransactionsByDate(transactions) {
  return transactions.sort((txA, txB) => {
    const txADate = new Date(txA.ctMeta.ctmDate);
    const txBDate = new Date(txB.ctMeta.ctmDate);
    if (txADate > txBDate) return -1;
    if (txADate < txBDate) return 1;
    return 0;
  });
}
