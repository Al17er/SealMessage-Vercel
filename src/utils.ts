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

// 简单的 MIME 类型检测（基于文件头）
function detectMimeType(buffer: Uint8Array): string {
  if (buffer.length < 4) return 'application/octet-stream';

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return 'image/gif';
  }
  // PDF: 25 50 44 46
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf';
  }
  // ZIP: 50 4B 03 04 或 50 4B 05 06 或 50 4B 07 08
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return 'application/zip';
  }

  // 检查是否为文本（简单判断：前 1KB 是否全是可打印 ASCII）
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
    // 进一步检查是否像 JSON
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

export const downloadAndDecrypt = async (
    blobIds: string[],
    sessionKey: SessionKey,
    suiClient: SuiClient,
    sealClient: SealClient,
    moveCallConstructor: (tx: Transaction, id: string) => void,
    setError: (error: string | null) => void,
    setDecryptedFiles: (files: DecryptedFile[]) => void, // ✅ 改为接收对象数组
    setIsDialogOpen: (open: boolean) => void,
    setReloadKey: (updater: (prev: number) => number) => void,
) => {
  const aggregators = [
    'aggregator1',
    'aggregator2',
    'aggregator3',
    'aggregator4',
    'aggregator5',
    'aggregator6',
  ];

  // Step 1: Download all blobs in parallel
  const downloadResults = await Promise.all(
      blobIds.map(async (blobId) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          const randomAggregator = aggregators[Math.floor(Math.random() * aggregators.length)];
          const aggregatorUrl = `/${randomAggregator}/v1/blobs/${blobId}`;
          const response = await fetch(aggregatorUrl, { signal: controller.signal });
          clearTimeout(timeout);
          if (!response.ok) {
            console.warn(`Failed to fetch blob ${blobId}: ${response.status}`);
            return null;
          }
          return await response.arrayBuffer();
        } catch (err) {
          console.error(`Blob ${blobId} cannot be retrieved from Walrus`, err);
          return null;
        }
      }),
  );

  const validDownloads = downloadResults.filter((result): result is ArrayBuffer => result !== null);
  console.log('Valid downloads count:', validDownloads.length);

  if (validDownloads.length === 0) {
    const errorMsg =
        'Cannot retrieve files from Walrus aggregators. Files older than 1 epoch may have been deleted.';
    setError(errorMsg);
    return;
  }

  // Step 2: Fetch decryption keys in batches (<=10)
  for (let i = 0; i < validDownloads.length; i += 10) {
    const batch = validDownloads.slice(i, i + 10);
    const ids = batch.map((enc) => EncryptedObject.parse(new Uint8Array(enc)).id);
    const tx = new Transaction();
    ids.forEach((id) => moveCallConstructor(tx, id));
    const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
    try {
      await sealClient.fetchKeys({ ids, txBytes, sessionKey, threshold: 2 });
    } catch (err) {
      const errorMsg =
          err instanceof NoAccessError
              ? 'No access to decryption keys'
              : 'Unable to fetch decryption keys, try again';
      console.error(errorMsg, err);
      setError(errorMsg);
      return;
    }
  }

  // Step 3: Decrypt each file and detect MIME type
  const decryptedFiles: DecryptedFile[] = [];
  for (const encryptedData of validDownloads) {
    const uint8Encrypted = new Uint8Array(encryptedData);
    const fullId = EncryptedObject.parse(uint8Encrypted).id;
    const tx = new Transaction();
    moveCallConstructor(tx, fullId);
    const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });

    try {
      const decryptedBytes = await sealClient.decrypt({
        data: uint8Encrypted,
        sessionKey,
        txBytes,
      });

      const mimeType = detectMimeType(decryptedBytes);
      const blob = new Blob([decryptedBytes.slice()], { type: mimeType });
      const url = URL.createObjectURL(blob);

      decryptedFiles.push({ url, mimeType });
    } catch (err) {
      const errorMsg =
          err instanceof NoAccessError
              ? 'No access to decryption keys'
              : 'Decryption failed for a file';
      console.error(errorMsg, err);
      setError(errorMsg);
      // Revoke any already created URLs to prevent leaks
      decryptedFiles.forEach(f => URL.revokeObjectURL(f.url));
      return;
    }
  }

  if (decryptedFiles.length > 0) {
    setDecryptedFiles(decryptedFiles); // ✅ 传入完整对象
    setIsDialogOpen(true);
    setReloadKey((prev) => prev + 1);
  }
};


export const getObjectExplorerUrl = (id: string): string => {
  return `https://testnet.suivision.xyz/object/${id}`;
};

export const getObjectExplorerLink = (id: string): React.ReactElement => {
  return React.createElement(
      'a',
      {
        href: getObjectExplorerUrl(id), // 👈 复用上面的函数
        target: '_blank',
        rel: 'noopener noreferrer',
        style: { textDecoration: 'underline' },
      },
      id.slice(0, 10) + '...',
  );
};

// export const getObjectExplorerLink = (id: string): React.ReactElement => {
//   return React.createElement(
//       'a',
//       {
//         href: `https://testnet.suivision.xyz/object/${id}`,
//         target: '_blank',
//         rel: 'noopener noreferrer',
//         style: { textDecoration: 'underline' },
//       },
//       id.slice(0, 10) + '...',
//   );
// };