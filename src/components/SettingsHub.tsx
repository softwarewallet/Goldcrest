import React, { useState } from 'react';
import {
  Server,
  Key,
  ShieldAlert,
  Sliders,
  Play,
  FileText,
  ShieldCheck,
  Award,
  Layers,
  CheckCircle2,
  Lock,
  Cpu
} from 'lucide-react';
import { BrokerSettingsPanel } from './BrokerSettingsPanel';
import { ModelGovernanceDashboard } from './ModelGovernanceDashboard';
import { BrokerType, TradingEnvironment } from '../brokers/types';

interface SettingsHubProps {
  currentEnvironment: TradingEnvironment;
  selectedBroker: BrokerType;
  onEnvironmentChange: (env: TradingEnvironment) => void;
  onBrokerSelect: (broker: BrokerType) => void;
  onRefreshGlobal?: () => void;
}

export const SettingsHub: React.FC<SettingsHubProps> = ({
  currentEnvironment,
  selectedBroker,
  onEnvironmentChange,
  onBrokerSelect,
  onRefreshGlobal
}) => {
  const [activeSettingsSection, setActiveSettingsSection] = useState<'BROKER_CONFIG' | 'GOVERNANCE'>('BROKER_CONFIG');

  return (
    <div id="unified_settings_hub" className="space-y-4">
      {/* Top Settings Sub-Navigation Tabs */}
      <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl p-2 px-3 shadow-md">
        <div className="flex items-center space-x-1.5 overflow-x-auto text-xs font-mono">
          <span className="text-slate-500 font-semibold px-2 uppercase text-[10px] hidden sm:inline">
            SETTINGS AREA:
          </span>
          {[
            { id: 'BROKER_CONFIG', label: 'BROKER & RISK CONFIGURATION', icon: Server },
            { id: 'GOVERNANCE', label: 'MODEL GOVERNANCE & READINESS GATES', icon: ShieldCheck }
          ].map(tab => {
            const Icon = tab.icon;
            const isSel = activeSettingsSection === tab.id;
            return (
              <button
                key={tab.id}
                id={`settings_section_${tab.id.toLowerCase()}`}
                onClick={() => setActiveSettingsSection(tab.id as any)}
                className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-lg font-bold transition whitespace-nowrap ${
                  isSel
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="hidden md:flex items-center space-x-2 text-[11px] font-mono text-slate-400">
          <Lock className="w-3.5 h-3.5 text-emerald-400" />
          <span>Encrypted Secure Storage</span>
        </div>
      </div>

      {/* Render Selected Sub-Section */}
      {activeSettingsSection === 'BROKER_CONFIG' && (
        <BrokerSettingsPanel
          currentEnvironment={currentEnvironment}
          selectedBroker={selectedBroker}
          onEnvironmentChange={onEnvironmentChange}
          onBrokerSelect={onBrokerSelect}
          onRefreshGlobal={onRefreshGlobal}
        />
      )}

      {activeSettingsSection === 'GOVERNANCE' && (
        <ModelGovernanceDashboard />
      )}
    </div>
  );
};
