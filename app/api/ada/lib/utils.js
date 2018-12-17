// @flow
import bs58 from 'bs58';
import cbor from 'cbor';
import borc from 'borc';
import BigNumber from 'bignumber.js';
import type {
  AdaTransactionInputOutput,
  Transaction,
  AdaTransaction,
  AdaTransactionCondition
} from '../adaTypes';
import {
  blake2b,
  // eslint-disable-next-line camelcase
  _sha3_256,
  isValidAddress
} from 'cardano-crypto.js';

export const localeDateToUnixTimestamp =
  (localeDate: string) => new Date(localeDate).getTime();

export function mapToList(map: any): Array<any> {
  return Object.values(map);
}

export function getAddressInHex(address: string): string {
  const bytes = bs58.decode(address);
  return bytes.toString('hex');
}

export type DecodedAddress = {
  root: string,
  attr: any,
  type: number,
  checksum: number
}

export function decodeAddress(address: string): DecodedAddress {
  if (!isValidAddress(address)) {
    throw new Error(`Invalid Cardano address`);
  }
  const bytes = bs58.decode(address);
  const [[addressData, checksum]] = cbor.decodeAllSync(bytes);
  const [[root, attr, type]] = cbor.decodeAllSync(addressData.value);
  return { root: root.toString('hex'), attr, type, checksum };
}

export function createAddressRoot(pubKey: Buffer, type: number, attr: any): Buffer {
  const newRootData = borc.encode([type, [type, pubKey], attr]);
  return blake2b(_sha3_256(newRootData), 28);
}

export const toAdaTx = function (
  amount: BigNumber,
  tx: Transaction,
  inputs: Array<AdaTransactionInputOutput>,
  isOutgoing: boolean,
  outputs: Array<AdaTransactionInputOutput>,
  time: string
): AdaTransaction {
  return {
    ctAmount: {
      getCCoin: amount.toString()
    },
    ctBlockNumber: Number(tx.block_num || ''),
    ctId: tx.hash,
    ctInputs: inputs,
    ctIsOutgoing: isOutgoing,
    ctMeta: {
      ctmDate: new Date(time),
      ctmDescription: undefined,
      ctmTitle: undefined,
      ctmUpdate: new Date(tx.last_update)
    },
    ctOutputs: outputs,
    ctCondition: _getTxCondition(tx.tx_state)
  };
};

/** Convert TxState from icarus-importer to AdaTransactionCondition */
const _getTxCondition = (state: string): AdaTransactionCondition => {
  if (state === 'Successful') return 'CPtxInBlocks';
  if (state === 'Pending') return 'CPtxApplying';
  return 'CPtxWontApply';
};

export function decodeRustTx(rustTxBody: RustRawTxBody): CryptoTransaction {
  if (!rustTxBody) {
    throw new Error('Cannot decode inputs from undefined transaction!');
  }
  const [[[inputs, outputs], witnesses]] = cbor.decodeAllSync(Buffer.from(rustTxBody));
  const decInputs: Array<TxInputPtr> = inputs.map(x => {
    const [[buf, idx]] = cbor.decodeAllSync(x[1].value);
    return {
      id: buf.toString('hex'),
      index: idx
    };
  });
  const decOutputs: Array<TxOutput> = outputs.map(x => {
    const [addr, val] = x;
    return {
      address: bs58.encode(cbor.encode(addr)),
      value: val
    };
  });
  const decWitnesses: Array<TxWitness> = witnesses.map(w => {
    if (w[0] === 0) {
      return {
        PkWitness: cbor.decodeAllSync(w[1].value)[0].map(x => x.toString('hex'))
      };
    }
    throw Error('Unexpected witness type: ' + w);
  });
  return {
    tx: {
      tx: {
        inputs: decInputs,
        outputs: decOutputs
      },
      witnesses: decWitnesses
    }
  };
}
