export type MarketBias = 'Bullish' | 'Bearish' | 'Neutral';
export type StrategyType = 'Bull Call Spread' | 'Bull Put Spread' | 'Bear Put Spread' | 'Iron Condor' | string;
export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

export interface OptionLeg {
  action: 'BUY' | 'SELL';
  strike: number;
  type: 'Call' | 'Put';
}

export interface ProposedTradeDetails {
  symbol: string;
  orderSide: 'BUY' | 'SELL';
  quantity: number;
  executionType: 'Market' | 'Limit' | 'Stop' | 'Stop Limit';
  entryPrice: string;
  guardianSL: string;
  guardianTP: string;
  strategy?: string;
  assetClass?: 'us_equity' | 'crypto' | string;
}

export interface AIOpportunity {
  id: string;
  symbol: string;
  name?: string;
  status: 'NEW' | 'EVALUATING' | 'READY';
  confidence: number;
  bias: MarketBias;
  strategy: StrategyType;
  legs: OptionLeg[];
  expiration: string;
  dte: number;
  maxRisk: number;
  potentialReward: number;
  riskRewardRatio: string;
  tags: string[];
  thesis: string;
  isPremium?: boolean;
  assetClass?: 'us_equity' | 'crypto' | string;
  isCrypto?: boolean;
  rvol?: number;
  agentVerdict?: string;
  devilAdvocateNote?: string;
  option_symbol?: string;
  stopLoss?: string;
  takeProfit?: string;
  currentPrice?: number;
  analysis?: any;
  proposedTrade?: ProposedTradeDetails;
  roc_30d?: number;
  sma50?: number;
  pct_from_sma20?: number;
  pct_from_sma50?: number;
  z_score_20d?: number;
  adx?: number;
  market_regime?: string;
  is_overextended?: boolean;
  volume_trend?: string;
  pullback_support_price?: number;
  expected_value?: number;
  devilAdvocateConcerns?: string[];
  adversarialVerdict?: string;
}

export interface ManagedPositionItem {
  asset_id: string;
  symbol: string;
  is_option: boolean;
  is_crypto?: boolean;
  asset_class?: string;
  underlying_symbol?: string;
  option_type?: string;
  strike_price?: number;
  expiration_date?: string;
  days_to_expiration?: number;
  qty: number;
  avg_entry_price: number;
  current_price: number;
  market_value: number;
  cost_basis: number;
  unrealized_pl: number;
  unrealized_plpc: number;
  recommendation: 'HOLD' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'EXPIRATION_GUARD' | string;
  action_reason: string;
}

export interface McpStatusResponse {
  status: string;
  server: string;
  version: string;
  environment: string;
  total_tools: number;
  cli_available: boolean;
  tools_sample?: Array<{ name: string; description: string }>;
}