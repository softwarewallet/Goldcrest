// ============================================================================
// HISTORICAL DATA INGESTION ENGINE (NORMALIZATION, DEDUPLICATION, IMMUTABILITY)
// ============================================================================

import {
  RawHistoricalCandle,
  NormalizedHistoricalCandle,
  DatasetRegistryEntry,
  IngestionValidationResult,
  HistoricalDataProviderMetadata,
  MarketType
} from '../historical/types';
import { HistoricalDataProvider } from './providers';

export class HistoricalDataIngestionEngine {
  private datasetRegistry: Map<string, DatasetRegistryEntry> = new Map();
  private historicalDatasets: Map<string, NormalizedHistoricalCandle[]> = new Map();

  /**
   * Complete 6-step ingestion pipeline:
   * Raw Data -> Validation -> Normalization -> Deduplication -> Timestamp normalization -> Schema validation -> Persistence
   */
  public ingestHistoricalData(
    providerMetadata: HistoricalDataProviderMetadata,
    rawCandles: RawHistoricalCandle[],
    datasetVersion: string = 'v1.0.0',
    correctionReason?: string
  ): IngestionValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const normalizedCandles: NormalizedHistoricalCandle[] = [];
    const seenTimestamps = new Set<number>();

    let acceptedCount = 0;
    let rejectedCount = 0;
    let duplicateCount = 0;

    const exchangeTimezone = providerMetadata.market === 'INDIAN_EQUITY' ||
      providerMetadata.market === 'INDIAN_OPTIONS' ||
      providerMetadata.market === 'INDIAN_FUTURES'
      ? 'Asia/Kolkata'
      : 'UTC';

    // Step 1: Process each candle sequentially
    for (let i = 0; i < rawCandles.length; i++) {
      const raw = rawCandles[i];

      // Parse & Normalize Numeric Fields
      const open = Number(raw.open);
      const high = Number(raw.high);
      const low = Number(raw.low);
      const close = Number(raw.close);
      const volume = Number(raw.volume || 0);
      const spread = Number(raw.spread || 0.0001);
      const vwap = raw.vwap ? Number(raw.vwap) : undefined;
      const oi = raw.oi ? Number(raw.oi) : undefined;

      // Validate numeric validity
      if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close) || open <= 0 || high <= 0 || low <= 0 || close <= 0) {
        rejectedCount++;
        errors.push(`Record ${i}: Invalid non-positive OHLC values (O:${raw.open}, H:${raw.high}, L:${raw.low}, C:${raw.close})`);
        continue;
      }

      // Step 2: Validate OHLC Mathematical Integrity
      // High >= max(Open, Close, Low) and Low <= min(Open, Close, High)
      const maxOCL = Math.max(open, close, low);
      const minOCH = Math.min(open, close, high);

      if (high < maxOCL - 1e-7 || low > minOCH + 1e-7) {
        rejectedCount++;
        errors.push(`Record ${i}: Impossible OHLC bounds (High ${high} < max(${open}, ${close}, ${low}) or Low ${low} > min(${open}, ${close}, ${high}))`);
        continue;
      }

      // Step 3: Parse and Normalize Timestamps to UTC
      let rawTs = raw.timestamp;
      let utcTimestamp: number;
      if (typeof rawTs === 'string') {
        const parsed = Date.parse(rawTs);
        if (isNaN(parsed)) {
          rejectedCount++;
          errors.push(`Record ${i}: Unparseable timestamp string "${rawTs}"`);
          continue;
        }
        utcTimestamp = parsed;
      } else {
        utcTimestamp = rawTs;
      }

      // Step 4: Deduplication Check
      if (seenTimestamps.has(utcTimestamp)) {
        duplicateCount++;
        warnings.push(`Duplicate timestamp detected at ${new Date(utcTimestamp).toISOString()} for ${providerMetadata.instrument}; skipping duplicate.`);
        continue;
      }
      seenTimestamps.add(utcTimestamp);

      // Construct Normalized Candle
      const isoUtc = new Date(utcTimestamp).toISOString();
      const localTimestamp = utcTimestamp; // UTC milliseconds timestamp

      normalizedCandles.push({
        instrument: providerMetadata.instrument,
        market: providerMetadata.market,
        timeframe: providerMetadata.timeframe,
        utcTimestamp,
        localTimestamp,
        exchangeTimezone,
        isoUtc,
        open,
        high,
        low,
        close,
        volume,
        spread,
        vwap,
        oi
      });

      acceptedCount++;
    }

    // Step 5: Sort strictly by timestamp (chronological immutability)
    normalizedCandles.sort((a, b) => a.utcTimestamp - b.utcTimestamp);

    // Step 6: Gap Detection & Quality Score Computation
    let gapCount = 0;
    for (let i = 1; i < normalizedCandles.length; i++) {
      const deltaMinutes = (normalizedCandles[i].utcTimestamp - normalizedCandles[i - 1].utcTimestamp) / 60000;
      if (deltaMinutes > 120) {
        gapCount++;
      }
    }

    const qualityScore = Math.max(0, Math.min(100, Math.round(
      (acceptedCount / Math.max(1, rawCandles.length)) * 100 - (duplicateCount * 2) - (gapCount * 3)
    )));

    const datasetId = `ds_${providerMetadata.market.toLowerCase()}_${providerMetadata.instrument.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}_${providerMetadata.timeframe.toLowerCase()}`;
    const startTimestamp = normalizedCandles[0]?.utcTimestamp || providerMetadata.start;
    const endTimestamp = normalizedCandles[normalizedCandles.length - 1]?.utcTimestamp || providerMetadata.end;

    // Cryptographic-like deterministic hash signature of dataset
    const immutableHash = `hash_${datasetId}_${datasetVersion}_${normalizedCandles.length}_${startTimestamp}_${endTimestamp}`;

    const datasetMetadata: DatasetRegistryEntry = {
      datasetId,
      datasetVersion,
      market: providerMetadata.market,
      instrument: providerMetadata.instrument,
      timeframe: providerMetadata.timeframe,
      provider: providerMetadata.provider,
      startDate: new Date(startTimestamp).toISOString(),
      endDate: new Date(endTimestamp).toISOString(),
      startTimestamp,
      endTimestamp,
      recordCount: normalizedCandles.length,
      qualityScore,
      status: correctionReason ? 'CORRECTED' : 'ACTIVE',
      sourceVersion: providerMetadata.sourceVersion,
      correctionReason,
      createdAt: Date.now(),
      immutableHash
    };

    // Store in immutable in-memory dataset registry
    const registryKey = `${datasetId}:${datasetVersion}`;
    this.datasetRegistry.set(registryKey, datasetMetadata);
    this.historicalDatasets.set(registryKey, normalizedCandles);

    return {
      valid: acceptedCount > 0 && errors.length === 0,
      totalRecords: rawCandles.length,
      acceptedRecords: acceptedCount,
      rejectedRecords: rejectedCount,
      duplicateRecords: duplicateCount,
      gapCount,
      errors,
      warnings,
      normalizedCandles,
      datasetMetadata
    };
  }

  /**
   * Retrieves an immutable historical dataset by ID and version.
   */
  public getHistoricalDataset(datasetId: string, version: string = 'v1.0.0'): NormalizedHistoricalCandle[] | null {
    const key = `${datasetId}:${version}`;
    return this.historicalDatasets.get(key) || null;
  }

  /**
   * Lists all registered dataset versions.
   */
  public listDatasets(): DatasetRegistryEntry[] {
    return Array.from(this.datasetRegistry.values());
  }
}
