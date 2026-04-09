# Scripts Directory

This directory contains utility scripts for managing the Splunk Enterprise deployment.

## Available Scripts

### destroy-all-stacks.sh (Recommended)

A script to destroy all CDK stacks in the correct order, handling dependencies automatically.

**Usage:**
```bash
./scripts/destroy-all-stacks.sh --profile <your-aws-profile>
```

**Features:**
- Automatically detects all deployed stacks
- Destroys stacks in reverse dependency order
- Handles dependency errors by retrying failed stacks
- Provides clear progress feedback
- Supports AWS profiles

**Options:**
- `--profile <profile-name>`: AWS profile to use for authentication

**Example:**
```bash
# Using AWS SSO profile
./scripts/destroy-all-stacks.sh --profile <your-aws-profile>

# Using default profile
./scripts/destroy-all-stacks.sh
```

**How it works:**
1. Lists all CDK stacks using `cdk list`
2. Reverses the order (since CDK lists them in deployment order)
3. Attempts to destroy each stack with `--force` flag
4. If a stack fails due to dependencies, it's added to a retry queue
5. After the first pass, retries any failed stacks
6. Continues until all stacks are successfully destroyed

**Error Handling:**
- If a stack fails due to dependency issues, it's automatically retried later
- If a stack fails for other reasons, the script exits with an error
- All output is logged for debugging purposes

---

### apply-letsencrypt-to-existing.sh

Applies Let's Encrypt certificates to all existing Search Head instances. Run this script **locally** — it auto-discovers instances from CloudFormation stack tags and applies the certificate via SSM Run Command. No SSH access required.

**Usage:**
```bash
./scripts/apply-letsencrypt-to-existing.sh \
  --email your-email@example.com \
  [--profile <your-aws-profile>] \
  [--region us-west-2]
```

**Options:**
- `--email <email>`: Email address for Let's Encrypt registration (required)
- `--profile <profile-name>`: AWS profile to use (optional)
- `--region <region>`: AWS region (default: us-west-2)

**What it does:**
1. Auto-discovers Search Head and ES Search Head instances from `SelfManagedSplunk-SearchHead` and `SelfManagedSplunk-ES` stacks
2. Sends the embedded certificate setup script to each instance via SSM Run Command
3. On each instance: installs certbot, obtains a Let's Encrypt certificate for the `sslip.io` domain, configures Splunk web.conf, and sets up auto-renewal
4. Waits for completion and displays the resulting `sslip.io` access URLs

See [`docs/enable-https-existing-instances.md`](../docs/enable-https-existing-instances.md) for full instructions.

---

## スクリプトディレクトリ

このディレクトリには、Splunk Enterpriseデプロイメントを管理するためのユーティリティスクリプトが含まれています。

## 利用可能なスクリプト

### destroy-all-stacks.sh（推奨）

依存関係を自動的に処理しながら、すべてのCDKスタックを正しい順序で削除するスクリプト。

**使用方法:**
```bash
./scripts/destroy-all-stacks.sh --profile <your-aws-profile>
```

**機能:**
- デプロイされたすべてのスタックを自動検出
- 依存関係の逆順でスタックを削除
- 依存関係エラーを処理し、失敗したスタックを再試行
- 明確な進行状況フィードバックを提供
- AWSプロファイルをサポート

**オプション:**
- `--profile <profile-name>`: 認証に使用するAWSプロファイル

**例:**
```bash
# AWS SSOプロファイルを使用
./scripts/destroy-all-stacks.sh --profile <your-aws-profile>

# デフォルトプロファイルを使用
./scripts/destroy-all-stacks.sh
```

**動作原理:**
1. `cdk list`を使用してすべてのCDKスタックをリスト
2. 順序を反転（CDKはデプロイ順でリストするため）
3. `--force`フラグを使用して各スタックの削除を試行
4. 依存関係でスタックが失敗した場合、再試行キューに追加
5. 最初のパスの後、失敗したスタックを再試行
6. すべてのスタックが正常に削除されるまで継続

**エラー処理:**
- 依存関係の問題でスタックが失敗した場合、後で自動的に再試行されます
- その他の理由でスタックが失敗した場合、スクリプトはエラーで終了します
- デバッグ用にすべての出力がログに記録されます

---

### apply-letsencrypt-to-existing.sh

既存のSearch HeadインスタンスにLet's Encrypt証明書を適用するスクリプト。**ローカルマシンで実行**します。CloudFormationスタックタグからインスタンスIDを自動検出し、SSM Run Command経由で証明書を適用します。SSH不要。

**使用方法:**
```bash
./scripts/apply-letsencrypt-to-existing.sh \
  --email your-email@example.com \
  [--profile <your-aws-profile>] \
  [--region us-west-2]
```

**オプション:**
- `--email <email>`: Let's Encrypt登録用メールアドレス（必須）
- `--profile <profile-name>`: AWSプロファイル（省略可）
- `--region <region>`: AWSリージョン（デフォルト: us-west-2）

**動作内容:**
1. `SelfManagedSplunk-SearchHead` および `SelfManagedSplunk-ES` スタックのタグからインスタンスIDを自動検出
2. 証明書セットアップスクリプトを埋め込みでSSM Run Commandを通じて各インスタンスに送信
3. 各インスタンスで: certbotのインストール、sslip.ioドメイン用Let's Encrypt証明書の取得、Splunk web.confの設定、自動更新の設定
4. 完了を待機してsslip.ioアクセスURLを表示

詳細は [`docs/enable-https-existing-instances.md`](../docs/enable-https-existing-instances.md) を参照してください。

---

