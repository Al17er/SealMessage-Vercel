// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { SealClient, SessionKey, NoAccessError, EncryptedObject } from '@mysten/seal';
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import React from 'react';

export type MoveCallConstructor = (tx: Transaction, id: string) => void;

// 新增：解密后的文件结构
export interface DecryptedFile {
  url: string;
  mimeType: string;
}

// MIME 类型检测（保持不变）
function detectMimeType(buffer: Uint8Array): string {
  if (buffer.length < 4) return 'application/octet-stream';

  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  // GIF
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return 'image/gif';
  }
  // PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf';
  }
  // ZIP
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return 'application/zip';
  }

  // Text detection
  const sample = buffer.slice(0, Math.min(1024, buffer.length));
  let isText = true;
  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i];
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte > 0x7e) {
      isText = false;
      break;
    }
  }
  if (isText) {
    try {
      const text = new TextDecoder().decode(sample);
      if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
        return 'application/json';
      }
    } catch {}
    return 'text/plain';
  }

  return 'application/octet-stream';
}

// ✅ 真实的 Walrus Aggregator 列表（可按需扩展）
const WALRUS_AGGREGATORS = [
  'https://aggregator.walrus.space',
  'https://walrus-aggregator.staketab.org',
  'https://walrus.redundex.com/aggregator',
  'https://walrus.nodes.guru/aggregator',
  'https://walrus.banansen.dev/aggregator',
  'https://walrus.everstake.one/aggregator',
];

export const downloadAndDecrypt = async (
    blobIds: string[],
    sessionKey: SessionKey,
    suiClient: SuiClient,
    sealClient: SealClient,
    moveCallConstructor: MoveCallConstructor,
    setError: (error: string | null) => void,
    setDecryptedFiles: (files: DecryptedFile[]) => void,
    setIsDialogOpen: (open: boolean) => void,
    setReloadKey: (updater: (prev: number) => number) => void,
) => {
  setError(null);
  const decryptedFiles: DecryptedFile[] = [];

  // Step 1: Download all blobs in parallel
  const downloadResults = await Promise.all(
      blobIds.map(async (blobId) => {
        for (const baseUrl of WALRUS_AGGREGATORS) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
            const url = `${baseUrl}/v1/blobs/${blobId}`;
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            if (response.ok) {
              return await response.arrayBuffer();
            }
          } catch (err) {
            console.warn(`Failed to fetch from ${baseUrl}:`, err);
          }
        }
        console.warn(`All aggregators failed for blob: ${blobId}`);
        return null;
      })
  );

  const validDownloads = downloadResults.filter((r): r is ArrayBuffer => r !== null);
  if (validDownloads.length === 0) {
    setError('Cannot retrieve files from Walrus. They may have expired.');
    return;
  }

  // Step 2: Fetch decryption keys in batches (max 10 per tx)
  try {
    for (let i = 0; i < validDownloads.length; i += 10) {
      const batch = validDownloads.slice(i, i + 10);
      const ids: string[] = [];
      for (const data of batch) {
        try {
          const id = EncryptedObject.parse(new Uint8Array(data)).id;
          ids.push(id);
        } catch (parseErr) {
          console.error('Invalid encrypted object format:', parseErr);
          throw new Error('Corrupted or invalid encrypted data');
        }
      }

      const tx = new Transaction();
      ids.forEach((id) => moveCallConstructor(tx, id));
      // ✅ 修复：v0.x 使用 tx.build({ client })
      const txBytes = await tx.build({ client: suiClient });

      await sealClient.fetchKeys({
        ids,
        txBytes,
        sessionKey,
        threshold: 2,
      });
    }
  } catch (err) {
    const errorMsg =
        err instanceof NoAccessError
            ? 'You do not have access to decrypt these files.'
            : 'Failed to fetch decryption keys. Please try again.';
    console.error(errorMsg, err);
    setError(errorMsg);
    return;
  }

  // Step 3: Decrypt each file
  try {
    for (const encryptedData of validDownloads) {
      const uint8Encrypted = new Uint8Array(encryptedData);
      let fullId: string;
      try {
        fullId = EncryptedObject.parse(uint8Encrypted).id;
      } catch (parseErr) {
        throw new Error('Invalid encrypted file format');
      }

      const tx = new Transaction();
      moveCallConstructor(tx, fullId);
      // ✅ 修复：v0.x 使用 tx.build({ client })
      const txBytes = await tx.build({ client: suiClient });

      const decryptedBytes = await sealClient.decrypt({
        data: uint8Encrypted,
        sessionKey,
        txBytes,
      });

      const mimeType = detectMimeType(decryptedBytes);
      // ✅ 修复：确保 Blob 接收标准类型（避免 TS 报错）
      const blob = new Blob([decryptedBytes.slice()], { type: mimeType });
      const url = URL.createObjectURL(blob);

      decryptedFiles.push({ url, mimeType });
    }

    if (decryptedFiles.length > 0) {
      setDecryptedFiles(decryptedFiles);
      setIsDialogOpen(true);
      setReloadKey((prev) => prev + 1);
    }
  } catch (err) {
    // Clean up any created URLs on error
    decryptedFiles.forEach((f) => URL.revokeObjectURL(f.url));

    const errorMsg =
        err instanceof NoAccessError
            ? 'Decryption failed: no access to keys.'
            : 'Failed to decrypt one or more files.';
    console.error(errorMsg, err);
    setError(errorMsg);
  }
};

// ✅ 改为返回字符串 URL（更灵活）
export const getObjectExplorerLink = (id: string): string => {
  return `https://testnet.suivision.xyz/object/${id}`;
};