// @flow
import { Component } from 'react';
import type { Node } from 'react'
import styles from './SingleTokenRow.scss'
import NoAssetLogo from '../../../../assets/images/assets-page/asset-no.inline.svg';
import { formattedAmountToBigNumber, formattedAmountToNaturalUnits, truncateAddressShort, truncateToken } from '../../../../utils/formatters';
import globalMessages from '../../../../i18n/global-messages';
import vjf from 'mobx-react-form/lib/validators/VJF';
import { genFormatTokenAmount, getTokenName } from '../../../../stores/stateless/tokenHelpers';
import ReactToolboxMobxForm from '../../../../utils/ReactToolboxMobxForm';
import config from '../../../../config';
import BigNumber from 'bignumber.js';
import { defineMessages, intlShape } from 'react-intl';
import { AmountInputRevamp } from '../../../common/NumericInputRP';
import {
  MultiToken,
} from '../../../../api/common/lib/MultiToken';
import CloseIcon from '../../../../assets/images/forms/close.inline.svg';
import type { FormattedTokenDisplay } from '../../../../utils/wallet'
import type {
  TokenLookupKey,
  TokenEntry
} from '../../../../api/common/lib/MultiToken';
import type { TokenRow } from '../../../../api/ada/lib/storage/database/primitives/tables';
import type { UriParams } from '../../../../utils/URIHandling';
import type { $npm$ReactIntl$IntlFormat } from 'react-intl';
import LocalizableError from '../../../../i18n/LocalizableError';

type Props = {|
    +token: FormattedTokenDisplay,
    +addOrRemoveToken: (tokenId: string, status: boolean) => void,
    +classicTheme: boolean,
    +updateAmount: (?BigNumber) => void,
    +uriParams: ?UriParams,
    +selectedToken: void | $ReadOnly<TokenRow>,
    +validateAmount: (
      amountInNaturalUnits: BigNumber,
      tokenRow: $ReadOnly<TokenRow>,
    ) => Promise<[boolean, void | string]>,
    +defaultToken: $ReadOnly<TokenRow>,
    +getTokenInfo: $ReadOnly<Inexact<TokenLookupKey>> => $ReadOnly<TokenRow>,
    +fee: ?MultiToken,
    +isCalculatingFee: boolean,
    +error: ?LocalizableError,
    +totalInput: ?MultiToken,
|}

const messages = defineMessages({
    calculatingFee: {
        id: 'wallet.send.form.calculatingFee',
        defaultMessage: '!!!Calculating fee...',
    },
})
export default class SingleTokenRow extends Component<Props> {

  static contextTypes: {|intl: $npm$ReactIntl$IntlFormat|} = {
    intl: intlShape.isRequired,
  };

  getNumDecimals(): number {
    return this.props.token.info.Metadata.numberOfDecimals;
  }

  getTokenEntry: MultiToken => TokenEntry = (tokens) => {
    return this.props.selectedToken == null
      ? tokens.getDefaultEntry()
      : tokens.values.find(
        entry => entry.identifier === this.props.selectedToken?.Identifier
      ) ?? tokens.getDefaultEntry();
  }

  form: ReactToolboxMobxForm = new ReactToolboxMobxForm({
    fields: {
      amount: {
        label: this.context.intl.formatMessage(globalMessages.amountLabel),
        placeholder: this.props.classicTheme ?
          `0.${'0'.repeat(this.getNumDecimals())}` : '',
        value: this.props.getTokenAmount(this.props.token.info),
        validators: [async ({ field }) => {
          const amountValue: string = field.value;
          if (amountValue === '') {
            return [false, this.context.intl.formatMessage(globalMessages.fieldIsRequired)];
          }
          const formattedAmount = new BigNumber(formattedAmountToNaturalUnits(
            amountValue,
            this.getNumDecimals(),
          ));
          const isValidAmount = await this.props.validateAmount(
            formattedAmount,
            this.props.selectedToken ?? this.props.defaultToken
          );
          if (isValidAmount[0]) {
            this.props.updateAmount(formattedAmount);
          } else {
            this.props.updateAmount();
          }
          return isValidAmount;
        }],
      },
    },
  }, {
    options: {
      // if fields are pre-populated by URI, validate them right away
      showErrorsOnInit: this.props.uriParams,
      validateOnBlur: false,
      validateOnChange: true,
      validationDebounceWait: config.forms.FORM_VALIDATION_DEBOUNCE_WAIT,
    },
    plugins: {
      vjf: vjf()
    },
  });

  render(): Node {
    const { form } = this
    const { intl } = this.context;
    const { token } = this.props
    const amountField = form.$('amount');
    const amountFieldProps = amountField.bind();
    const formatValue = genFormatTokenAmount(this.props.getTokenInfo);

    let transactionFeeError = null;
    if (this.props.isCalculatingFee) {
      transactionFeeError = this.context.intl.formatMessage(messages.calculatingFee);
    }
    if (this.props.error) {
      transactionFeeError = this.context.intl.formatMessage(
        this.props.error,
        this.props.error.values
      );
    }

    const transactionFee = this.props.fee ?? new MultiToken([], {
      defaultIdentifier: this.props.defaultToken.Identifier,
      defaultNetworkId: this.props.defaultToken.NetworkId,
    });

    const totalAmount = this.props.totalInput ?? new MultiToken([{
      identifier: (this.props.selectedToken ?? this.props.defaultToken).Identifier,
      networkId: (this.props.selectedToken ?? this.props.defaultToken).NetworkId,
      amount: formattedAmountToBigNumber(amountFieldProps.value)
        .shiftedBy((this.props.selectedToken ?? this.props.defaultToken).Metadata.numberOfDecimals),
    }], {
      defaultIdentifier: this.props.defaultToken.Identifier,
      defaultNetworkId: this.props.defaultToken.NetworkId,
    });

    const amountInputError = transactionFeeError || amountField.error
    return (
      <div className={styles.component}>
        {!this.props.isTokenIncluded(token.info) ? (
          <button type='button' className={styles.token} onClick={() => this.props.onAddToken(token.info)}>
            <div className={styles.name}>
              <div className={styles.logo}><NoAssetLogo /></div>
              <p className={styles.label}>{token.label}</p>
            </div>
            <p className={styles.id}>{truncateAddressShort(token.id, 14)}</p>
            <p className={styles.amount}>{token.amount}</p>
          </button>
        ): (
          <div className={styles.amountWrapper}>
            <div className={styles.amountTokenName}>
              <div className={styles.logo}><NoAssetLogo /></div>
              <p className={styles.label}>{token.label}</p>
            </div>
            <div className={styles.amountInput}>
              <AmountInputRevamp
                {...amountFieldProps}
                value={amountFieldProps.value === ''
                  ? null
                  : formattedAmountToBigNumber(amountFieldProps.value)
                }
                className="tokenAmount"
                label={intl.formatMessage(globalMessages.amountLabel)}
                decimalPlaces={this.getNumDecimals()}
                currency={truncateToken(
                  getTokenName(this.props.selectedToken ?? this.props.defaultToken)
                )}
                fees={formatValue(transactionFee.getDefaultEntry())}
                total={formatValue(totalAmount.getDefaultEntry())}
                allowSigns={false}
                onFocus={() => this.props.onAddToken(token.info)}
                amountFieldRevamp
              />

            </div>
            <button type='button' onClick={() => this.props.onRemoveToken(token.info)} className={styles.close}> <CloseIcon /> </button>
            <p className={styles.error}>
              {token.info.Identifier === this.props.selectedToken?.Identifier && amountInputError}
            </p>
          </div>
           )}
      </div>
    )
  }
}