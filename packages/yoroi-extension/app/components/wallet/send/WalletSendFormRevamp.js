// @flow
import { Component } from 'react';
import type { Node } from 'react';
import { observer } from 'mobx-react';
import { reaction } from 'mobx';
import { Button } from '@mui/material';
import TextField from '../../common/TextField'
import { defineMessages, intlShape } from 'react-intl';
import { isValidMemoOptional, } from '../../../utils/validations';
import ReactToolboxMobxForm from '../../../utils/ReactToolboxMobxForm';
import vjf from 'mobx-react-form/lib/validators/VJF';
import { AmountInputRevamp } from '../../common/NumericInputRP';
import styles from './WalletSendFormRevamp.scss';
import globalMessages, { memoMessages, } from '../../../i18n/global-messages';
import type { UriParams } from '../../../utils/URIHandling';
import { getAddressPayload, isValidReceiveAddress } from '../../../api/ada/lib/storage/bridge/utils';
import { MAX_MEMO_SIZE } from '../../../config/externalStorageConfig';
import type { TokenRow, NetworkRow } from '../../../api/ada/lib/storage/database/primitives/tables';
import {
  formattedAmountToBigNumber,
  formattedAmountToNaturalUnits,
  truncateToken,
} from '../../../utils/formatters';
import config from '../../../config';
import LocalizableError from '../../../i18n/LocalizableError';
import type { $npm$ReactIntl$IntlFormat } from 'react-intl';
import {
  getTokenName, genFormatTokenAmount, getTokenStrictName, getTokenIdentifierIfExists,
  // getTokenStrictName, getTokenIdentifierIfExists,
} from '../../../stores/stateless/tokenHelpers';
import {
  MultiToken,
} from '../../../api/common/lib/MultiToken';
import type {
  TokenLookupKey,
} from '../../../api/common/lib/MultiToken';
import BigNumber from 'bignumber.js';
import classnames from 'classnames';
import SendFormHeader from './SendFormHeader';
import { SEND_FORM_STEP } from '../../../types/WalletSendTypes';
import { isErgo } from '../../../api/ada/lib/storage/database/prepackaged/networks';
import PlusIcon from '../../../assets/images/plus.inline.svg'
import AddNFTDialog from './WalletSendFormSteps/AddNFTDialog';
import AddTokenDialog from './WalletSendFormSteps/AddTokenDialog';
import IncludedTokens from './WalletSendFormSteps/IncludedTokens';
import { getNFTs, getTokens } from '../../../utils/wallet';

const messages = defineMessages({
  receiverLabel: {
    id: 'wallet.send.form.receiver.label',
    defaultMessage: '!!!Receiver',
  },
  receiverHint: {
    id: 'wallet.send.form.receiver.hint',
    defaultMessage: '!!!Wallet Address',
  },
  dropdownAmountLabel: {
    id: 'wallet.send.form.sendAll.dropdownAmountLabel',
    defaultMessage: '!!!Send all {coinName}',
  },
  allTokens: {
    id: 'wallet.send.form.sendAll.allTokens',
    defaultMessage: '!!! + all tokens',
  },
  selectedAmountLable: {
    id: 'wallet.send.form.sendAll.selectedAmountLable',
    defaultMessage: '!!!Amount Options',
  },
  customAmount: {
    id: 'wallet.send.form.sendAll.customAmount',
    defaultMessage: '!!!Custom Amount',
  },
  transactionFeeError: {
    id: 'wallet.send.form.transactionFeeError',
    defaultMessage: '!!!Not enough Ada for fees. Try sending a smaller amount.',
  },
  calculatingFee: {
    id: 'wallet.send.form.calculatingFee',
    defaultMessage: '!!!Calculating fee...',
  },
  memoInvalidOptional: {
    id: 'wallet.transaction.memo.optional.invalid',
    defaultMessage: '!!!Memo cannot be more than {maxMemo} characters.',
  },
  willSendAll: {
    id: 'wallet.send.form.willSendAll',
    defaultMessage: '!!!Will Send All Tokens!'
  },
  amountMinAdaIncluded: {
    id: 'wallet.send.form.revamp.amountMinAdaIncluded',
    defaultMessage: '!!!Amount (includes min-ADA)'
  },
  transactionFee: {
    id: 'wallet.send.form.revamp.transactionFee',
    defaultMessage: '!!!Transaction fee',
  },
  total: {
    id: 'wallet.send.confirmationDialog.totalLabel',
    defaultMessage: '!!!Total',
  },
  nAssets: {
    id: 'wallet.send.form.nAssets',
    defaultMessage: '!!!{number} assets',
  },
  max: {
    id: 'wallet.send.form.max',
    defaultMessage: '!!!MAX',
  }
});

type Props = {|
  +selectedNetwork: $ReadOnly<NetworkRow>,
  +hasAnyPending: boolean,
  +validateAmount: (
    amountInNaturalUnits: BigNumber,
    tokenRow: $ReadOnly<TokenRow>,
  ) => Promise<[boolean, void | string]>,
  +onSubmit: void => void,
  +totalInput: ?MultiToken,
  +classicTheme: boolean,
  +updateReceiver: (void | string) => void,
  +updateAmount: (?BigNumber) => void,
  +updateMemo: (void | string) => void,
  +shouldSendAll: boolean,
  +updateSendAllStatus: (void | boolean) => void,
  +fee: ?MultiToken,
  +isCalculatingFee: boolean,
  +reset: void => void,
  +error: ?LocalizableError,
  +uriParams: ?UriParams,
  +resetUriParams: void => void,
  +showMemo: boolean,
  +onAddMemo: void => void,
  +getTokenInfo: $ReadOnly<Inexact<TokenLookupKey>> => $ReadOnly<TokenRow>,
  +defaultToken: $ReadOnly<TokenRow>, // need since no guarantee input in non-null
  +onAddToken: (void | $ReadOnly<TokenRow>) => void,
  +spendableBalance: ?MultiToken,
  +selectedToken: void | $ReadOnly<TokenRow>,
  +previewStep: () => Node,
  +openDialog: any => void,
|};

type State = {|
  showMemoWarning: boolean,
  invalidMemo: boolean,
  memo: string,
  currentStep: number,
|}

@observer
export default class WalletSendForm extends Component<Props, State> {

  static contextTypes: {|intl: $npm$ReactIntl$IntlFormat|} = {
    intl: intlShape.isRequired,
  };

  state: State = {
    showMemoWarning: false,
    invalidMemo: false,
    memo: '',
    currentStep: SEND_FORM_STEP.RECEIVER
  }

  amountFieldReactionDisposer: null | (() => mixed) = null;

  componentDidMount(): void {
    this.props.reset();

    const formatValue = genFormatTokenAmount(this.props.getTokenInfo);
    if (this.props.uriParams) {
      // assert not null
      const uriParams = this.props.uriParams;

      // note: assume these are validated externally
      this.props.updateAmount(uriParams.amount.getDefaultEntry().amount);
      this.props.updateReceiver(getAddressPayload(uriParams.address, this.props.selectedNetwork));
      this.props.resetUriParams();
    }

    /**
     * Mobx-react-form doesn't allow the value field to be updated based on a computed variable
     * so instead we register a reaction to update it
     */
    this.amountFieldReactionDisposer = reaction(
      () => [this.props.shouldSendAll, this.props.totalInput],
      () => {
        if (!this.props.totalInput || !this.props.fee) {
          return;
        }
        const totalInput = this.props.totalInput;
        const fee = this.props.fee;
        if (!this.props.shouldSendAll) {
          return;
        }

        // once sendAll is triggered, set the amount field to the total input
        const adjustedInput = totalInput.joinSubtractCopy(fee);
        const relatedEntry = adjustedInput.getDefaultEntry();
        this.form.$('amount').set('value', formatValue(
          relatedEntry,
        ));
      },
    );
  }

  componentWillUnmount(): void {
    this.props.reset();
    // dispose reaction
    if (this.amountFieldReactionDisposer != null) {
      this.amountFieldReactionDisposer();
    }
  }

  // FORM VALIDATION
  form: ReactToolboxMobxForm = new ReactToolboxMobxForm({
    fields: {
      receiver: {
        label: this.context.intl.formatMessage(messages.receiverLabel),
        placeholder: this.props.classicTheme ?
          this.context.intl.formatMessage(messages.receiverHint) : '',
        value: this.props.uriParams
          ? this.props.uriParams.address
          : '',
        validators: [({ field }) => {
          const receiverValue = field.value;
          if (receiverValue === '') {
            this.props.updateReceiver();
            return [false, this.context.intl.formatMessage(globalMessages.fieldIsRequired)];
          }
          const updateReceiver = (isValid: bool) => {
            if (isValid) {
              this.props.updateReceiver(
                getAddressPayload(receiverValue, this.props.selectedNetwork)
              );
            } else {
              this.props.updateReceiver();
            }
          };

          const isValid = isValidReceiveAddress(receiverValue, this.props.selectedNetwork);
          if (isValid === true) {
            updateReceiver(true);
            return [isValid];
          }
          updateReceiver(isValid[0]);
          return [isValid[0], this.context.intl.formatMessage(isValid[1])];
        }],
      },
      amount: {
        label: this.context.intl.formatMessage(globalMessages.amountLabel),
        placeholder: this.props.classicTheme ?
          `0.${'0'.repeat(this.getNumDecimals())}` : '',
        value: (() => {
          const formatValue = genFormatTokenAmount(this.props.getTokenInfo);
          return this.props.uriParams
            ? formatValue(
              this.props.uriParams.amount.getDefaultEntry(),
            )
            : null
        })(),
        validators: [async ({ field }) => {
          if (this.props.shouldSendAll) {
            // sendall doesn't depend on the amount so always succeed
            return true;
          }
          const amountValue: string = field.value;
          // Amount Field should be optional
          if (!amountValue) {
            this.props.updateAmount();
            const defaultTokenInfo = this.props.getTokenInfo({
              identifier: this.props.defaultToken.Identifier,
              networkId: this.props.defaultToken.NetworkId,
            })

            this.props.onRemoveToken(defaultTokenInfo)
            return true
          }
          const formattedAmount = new BigNumber(formattedAmountToNaturalUnits(
            amountValue,
            this.getNumDecimals(),
          ));
          const isValidAmount = await this.props.validateAmount(
            formattedAmount,
            this.props.defaultToken
          );
          if (isValidAmount[0]) {
            this.props.updateAmount(formattedAmount);
          } else {
            this.props.updateAmount();
          }
          return isValidAmount;
        }],
      },
      selectedToken: {
        label: this.context.intl.formatMessage(globalMessages.assetSelect),
        value: this.props.selectedToken?.TokenId ?? this.props.getTokenInfo({
          identifier: this.props.defaultToken.Identifier,
          networkId: this.props.defaultToken.NetworkId,
        }).TokenId,
      },
      memo: {
        label: this.context.intl.formatMessage(memoMessages.memoLabel),
        placeholder: this.context.intl.formatMessage(memoMessages.optionalMemo),
        value: '',
        validators: [({ field }) => {
          const memoContent = field.value;
          const isValid = isValidMemoOptional(memoContent);
          if (isValid) {
            this.props.updateMemo(memoContent);
          }
          return [
            isValid,
            this.context.intl.formatMessage(
              messages.memoInvalidOptional,
              { maxMemo: MAX_MEMO_SIZE, }
            )
          ];
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

  getNumDecimals(): number {
    const info = this.props.getTokenInfo({
      identifier: this.props.defaultToken.Identifier,
      networkId: this.props.defaultToken.NetworkId,
    });
    return info.Metadata.numberOfDecimals;
  }

  getTokensAndNFTs = (totalAmount) => {
    if (this.props.shouldSendAll) return [
      getTokens(totalAmount, this.props.getTokenInfo),
      getNFTs(totalAmount, this.props.getTokenInfo)
    ];
    const { plannedTxInfoMap } = this.props;
    const tokens = plannedTxInfoMap.filter(
      ({ token }) => !token.IsNFT && !token.IsDefault
    ).map(({ token, amount }) => ({
      label: truncateToken(getTokenStrictName(token) ?? getTokenIdentifierIfExists(token) ?? '-'),
      amount: amount?.toString(),
      info: token,
    }));

    const nfts = plannedTxInfoMap.filter(
      ({ token }) => token.IsNFT
    ).map(({ token }) => {
      const policyId = token.Identifier.split('.')[0];
      return {
          name: truncateToken(getTokenStrictName(token) ?? '-'),
          // $FlowFixMe[prop-missing]
          image: token.Metadata.assetMintMetadata?.[0]['721'][policyId][name]?.image,
          info: token,
      };
    });

    return [tokens, nfts]
  }

  renderCurrentStep(step: number): Node {
    const { form } = this
    const { intl } = this.context;
    const { showMemoWarning, invalidMemo, memo } = this.state
    const { shouldSendAll } = this.props
    const amountField = form.$('amount');
    const receiverField = form.$('receiver');
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
      identifier: this.props.defaultToken.Identifier,
      networkId: this.props.defaultToken.NetworkId,
      amount: formattedAmountToBigNumber(amountFieldProps.value)
        .shiftedBy(this.props.defaultToken.Metadata.numberOfDecimals),
    }], {
      defaultIdentifier: this.props.defaultToken.Identifier,
      defaultNetworkId: this.props.defaultToken.NetworkId,
    });

    const amountInputError = transactionFeeError || amountField.error
    const [tokens, nfts] = this.getTokensAndNFTs(totalAmount)

    switch (step) {
      case SEND_FORM_STEP.RECEIVER:
        return (
          <div className={styles.receiverStep}>
            <div className={styles.receiverInput}>
              <TextField
                className="send_form_receiver"
                {...receiverField.bind()}
                error={receiverField.error}
                done={receiverField.isValid}
              />
            </div>
            <div className={styles.memo}>
              <div className={styles.memoInput}>
                <input
                  type="text"
                  onFocus={() => this.setState({ showMemoWarning: true })}
                  placeholder={intl.formatMessage(memoMessages.addMemo)}
                  onChange={(e) => this.onUpdateMemo(e.target.value)}
                  value={memo}
                />
              </div>
              {invalidMemo ? (
                <p className={styles.memoError}>
                  {intl.formatMessage(messages.memoInvalidOptional,{ maxMemo: MAX_MEMO_SIZE, })}
                </p>
              ):
                <p className={classnames(
                [ styles.memoWarning, !showMemoWarning && styles.hide]
                )}
                >
                  {intl.formatMessage(memoMessages.memoWarning)}
                </p>
              }
            </div>
            <div>
              {this._nextStepButton(
                invalidMemo || !receiverField.isValid,
                () => this.onUpdateStep(SEND_FORM_STEP.AMOUNT)
              )}
            </div>
          </div>
        )
        case SEND_FORM_STEP.AMOUNT:
          return (
            <div className={styles.amountStep}>
              <div className={classnames(
                [styles.amountInput,
                  amountInputError && styles.amountInputError,
                  shouldSendAll && styles.disabled
                ])}
              >
                <span className={classnames([styles.label, shouldSendAll && styles.labelDisabled])}>
                  {intl.formatMessage(globalMessages.amountLabel)}
                </span>
                <div className={styles.amountInputGrid}>
                  <AmountInputRevamp
                    {...amountFieldProps}
                    value={amountFieldProps.value === ''
                      ? null
                      : formattedAmountToBigNumber(amountFieldProps.value)}
                    className="send_form_amount"
                    label={intl.formatMessage(globalMessages.amountLabel)}
                    decimalPlaces={this.getNumDecimals()}
                    disabled={shouldSendAll}
                    error={amountInputError}
                    currency={truncateToken(
                      getTokenName(this.props.defaultToken)
                    )}
                    fees={formatValue(transactionFee.getDefaultEntry())}
                    total={formatValue(totalAmount.getDefaultEntry())}
                    allowSigns={false}
                    onFocus={() => {
                      this.props.onAddToken({
                        shouldReset: false,
                      });
                    }}
                    amountFieldRevamp
                  />
                  <p className={styles.defaultCoin}>
                    {isErgo(this.props.selectedNetwork) ? 'ERG' : 'ADA'}
                  </p>
                  <Button
                    variant="ternary"
                    sx={{ minWidth: '56px', minHeight: '30px' }}
                    onClick={() => {
                      if (shouldSendAll) {
                        amountField.reset();
                        this.props.onRemoveToken(); // remove default token
                        this.props.updateSendAllStatus(false);
                      } else {
                        this.props.onAddToken({
                          shouldReset: true,
                        });
                        this.props.updateSendAllStatus(true);
                      }
                    }}
                  >
                    {intl.formatMessage(messages.max)}
                  </Button>
                </div>

                <div className={styles.usd}>
                  <p>$0</p>
                </div>
                {(!this.props.selectedToken ||
                  this.props.selectedToken?.Identifier === this.props.defaultToken.Identifier) ? (
                    <p className={styles.amountError}>
                      {amountInputError}
                    </p>): null}
              </div>

              <IncludedTokens
                tokens={tokens}
                nfts={nfts}
                onRemoveToken={this.props.onRemoveToken}
                shouldSendAll={shouldSendAll}
              />

              <div className={styles.addButtonsWrapper}>
                <Button
                  variant="ternary"
                  sx={{ width: '160px', marginRight: '16px' }}
                  onClick={() => this.props.openDialog(AddTokenDialog)}
                  disabled={this.props.shouldSendAll}
                >
                  <PlusIcon />
                  <p className={styles.btnText}>{intl.formatMessage(globalMessages.token)}</p>
                </Button>
                <Button
                  variant="ternary"
                  sx={{ width: '160px' }}
                  onClick={() => this.props.openDialog(AddNFTDialog)}
                  disabled={this.props.shouldSendAll}
                >
                  <PlusIcon />
                  <p className={styles.btnText}>{intl.formatMessage(globalMessages.nfts)}</p>
                </Button>
              </div>

              {this._nextStepButton(
               !this.props.fee || this.props.hasAnyPending || !isValidMemoOptional(memo),
               () => {
                this.props.onSubmit()
                this.onUpdateStep(SEND_FORM_STEP.PREVIEW)
               })}
            </div>
          )
        case SEND_FORM_STEP.PREVIEW:
            return this.props.previewStep()
        default:
          throw Error(`${step} is not a valid step`)
    }
  }

  render(): Node {
    const { currentStep } = this.state
    return (
      <div className={styles.component}>
        <div className={styles.wrapper}>
          <SendFormHeader
            step={currentStep}
            onUpdateStep={this.onUpdateStep.bind(this)}
          />

          <div className={styles.formBody}>
            {this.renderCurrentStep(currentStep)}
          </div>
        </div>
      </div>
    );
  }

  onUpdateStep(step: number) {
    if (step > 3) throw new Error('Invalid Step number.')
    this.setState({ currentStep: step })
  }

  onUpdateMemo(memo: string) {
    const isValid = isValidMemoOptional(memo);
    if (isValid) {
      this.props.updateMemo(memo);
      this.setState({ memo, invalidMemo: false })
    } else {
      this.setState({ invalidMemo: true })
    }
  }

  _nextStepButton(
    disabledCondition: boolean,
    nextStep: () => void
  ): Node {
    const { intl } = this.context;

    return (
      <Button
        variant="primary"
        onClick={nextStep}
        /** Next Action can't be performed in case transaction fees are not calculated
          * or there's a transaction waiting to be confirmed (pending) */
        disabled={disabledCondition}
        sx={{ margin: '125px 0px 0px 0px', display: 'block' }}
      >
        {intl.formatMessage(globalMessages.nextButtonLabel)}
      </Button>);
  }

  _makeInvokeConfirmationButton(): Node {
    const { intl } = this.context;
    const { memo } = this.form.values();

    const {
      hasAnyPending,
    } = this.props;

    const disabledCondition = (
      !this.props.fee
      || hasAnyPending
      || !isValidMemoOptional(memo)
    );

    return (
      <Button
        variant="primary"
        onClick={this.props.onSubmit}
        /** Next Action can't be performed in case transaction fees are not calculated
          * or there's a transaction waiting to be confirmed (pending) */
        disabled={disabledCondition}
        sx={{ margin: '30px auto 0', display: 'block' }}
      >
        {intl.formatMessage(globalMessages.nextButtonLabel)}
      </Button>);
  }
}
