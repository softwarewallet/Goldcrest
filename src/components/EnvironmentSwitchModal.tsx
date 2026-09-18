import React from 'react';
import { AlertTriangle, ShieldAlert, CheckCircle2, X } from 'lucide-react';
import { TradingEnvironment, BrokerType } from '../brokers/types';

interface EnvironmentSwitchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  currentEnv: TradingEnvironment;
  targetEnv: TradingEnvironment;
  broker: BrokerType;
  maskedAccount?: string;
  currency?: string;
  balance?: number;
}

export const EnvironmentSwitchModal: React.FC<EnvironmentSwitchModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  currentEnv,
  targetEnv,
  broker,
  maskedAccount = '****',
  currency = 'USD',
  balance
}) => {
  if (!isOpen) return null;

  const isSwitchingToLive = targetEnv === 'LIVE';

  return (
    <div id="env_switch_modal_overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div id="env_switch_modal_card" className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-5 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            {isSwitchingToLive ? (
              <ShieldAlert className="w-5 h-5 text-rose-500" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            )}
            <h3 className="text-base font-bold text-white">
              Confirm Trading Environment Switch
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isSwitchingToLive && (
          <div className="bg-rose-950/60 border border-rose-700/80 rounded-lg p-3 text-xs text-rose-200 space-y-1.5">
            <div className="font-bold flex items-center space-x-1.5 text-rose-300">
              <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>LIVE TRADING ENVIRONMENT ACTIVATION</span>
            </div>
            <p>
              Live credentials can access real-money trading functionality. Verify the account, permissions, risk settings, and environment before enabling live execution.
            </p>
          </div>
        )}

        <div className="bg-slate-950 rounded-lg border border-slate-800 p-3 space-y-2 text-xs font-mono">
          <div className="flex justify-between py-1 border-b border-slate-800/80">
            <span className="text-slate-400">Current Environment:</span>
            <span className="font-bold text-slate-200">{currentEnv} MODE</span>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-800/80">
            <span className="text-slate-400">Target Environment:</span>
            <span className={`font-bold ${isSwitchingToLive ? 'text-rose-400' : 'text-amber-300'}`}>
              {targetEnv} MODE
            </span>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-800/80">
            <span className="text-slate-400">Selected Broker:</span>
            <span className="text-slate-200">{broker}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-800/80">
            <span className="text-slate-400">Account (Masked):</span>
            <span className="text-slate-200">{maskedAccount}</span>
          </div>
          {balance !== undefined && (
            <div className="flex justify-between py-1">
              <span className="text-slate-400">Available Balance:</span>
              <span className="text-emerald-400 font-bold">{currency} {balance.toLocaleString()}</span>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-400">
          The application will strictly isolate order routing, account data, and market execution to the target <strong className="text-slate-200">{targetEnv}</strong> environment.
        </p>

        <div className="flex items-center justify-end space-x-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
          >
            Cancel
          </button>
          <button
            id="btn_confirm_env_switch"
            onClick={onConfirm}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition flex items-center space-x-1.5 ${
              isSwitchingToLive
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-950'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Confirm Switch to {targetEnv}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
