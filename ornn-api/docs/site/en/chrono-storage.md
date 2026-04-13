# chrono-storage

## Overview

chrono-storage is an S3-compatible object storage service used by Ornn to manage skill packages.

## Features

- S3-compatible API
- Presigned URL generation for secure uploads/downloads
- Bucket-based organization
- Object lifecycle management

## Usage in Ornn

Ornn uses chrono-storage for:

### Package Upload

When a skill is created, the ZIP package is uploaded to chrono-storage:

1. Backend generates a presigned upload URL
2. Package is uploaded directly to storage
3. Storage path is saved in MongoDB metadata

### Package Download

When viewing or executing a skill:

1. Backend generates a presigned download URL
2. Client or sandbox retrieves the package

### Package Deletion

When a skill is deleted, the corresponding storage object is removed.

## Configuration

| Environment Variable | Description |
|---------------------|-------------|
| `STORAGE_ENDPOINT` | chrono-storage service URL |
| `STORAGE_ACCESS_KEY` | Access key for authentication |
| `STORAGE_SECRET_KEY` | Secret key for authentication |
| `STORAGE_BUCKET` | Bucket name for skill packages |
| `STORAGE_REGION` | Storage region |
