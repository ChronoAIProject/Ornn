# chrono-storage

## 概述

chrono-storage 是一个 S3 兼容的对象存储服务，Ornn 用它来管理技能包。

## 功能

- S3 兼容 API
- 预签名 URL 生成，用于安全上传/下载
- 基于桶的组织结构
- 对象生命周期管理

## 在 Ornn 中的使用

Ornn 将 chrono-storage 用于：

### 包上传

创建技能时，ZIP 包上传到 chrono-storage：

1. 后端生成预签名上传 URL
2. 包直接上传到存储
3. 存储路径保存在 MongoDB 元数据中

### 包下载

查看或执行技能时：

1. 后端生成预签名下载 URL
2. 客户端或沙箱检索包

### 包删除

技能删除时，对应的存储对象被移除。

## 配置

| 环境变量 | 描述 |
|---------|------|
| `STORAGE_ENDPOINT` | chrono-storage 服务 URL |
| `STORAGE_ACCESS_KEY` | 认证访问密钥 |
| `STORAGE_SECRET_KEY` | 认证密钥 |
| `STORAGE_BUCKET` | 技能包的桶名称 |
| `STORAGE_REGION` | 存储区域 |
