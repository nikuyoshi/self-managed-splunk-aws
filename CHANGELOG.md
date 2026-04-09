# Changelog

[English](#english) | [日本語](#japanese)

---

## English

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

### [Unreleased]

#### Added
- 🔒 **Let's Encrypt Certificate Support**: Added support for browser-trusted HTTPS certificates
  - Automatic Let's Encrypt certificate generation using certbot
  - sslip.io domain integration for automatic DNS resolution
  - Required email address validation for Let's Encrypt registration
  - Automatic certificate renewal via cron job (90-day cycle)
  - Permission fixes for certificate files to ensure Splunk user access
  - Context parameter `httpsType` to choose between self-signed and Let's Encrypt
  - Interactive deployment wizard includes certificate type selection
- 🔒 **HTTPS Support for Search Heads**: Implemented HTTPS with self-signed certificates for all Search Head instances
  - Automatic self-signed certificate generation during instance initialization
  - HTTPS on port 8443 for both regular Search Head and ES Search Head
  - Certificate CN automatically set to instance's public IP
  - Security group rules updated to allow port 8443
  - Web UI URLs in CloudFormation outputs updated to HTTPS
- 🔑 **AWS Profile Support in Interactive Deployment**: Interactive deployment wizard now includes AWS profile selection
  - Automatically detects available AWS profiles using `aws configure list-profiles`
  - Allows selection of specific profile or use of environment variables
  - Profile is passed to CDK command with `--profile` option
- ⚡ **Auto-approve Option**: Added option to auto-approve CloudFormation changes
  - Interactive prompt for `--require-approval never` option
  - Enables unattended deployments for CI/CD pipelines
  - Useful when changes have been pre-reviewed

#### Changed
- 🎯 **Simplified Deployment Configurations**: Replaced flexible indexer count with fixed deployment sizes
  - Removed customizable indexer count, replication factor, and search factor
  - Implemented fixed Medium (3 indexers) and Large (6 indexers) configurations
  - Ensures Splunk best practices with RF=3, SF=2 for both sizes
  - Prevents invalid configurations and improves user experience

### [1.3.1] - 2025-08-07

#### Fixed
- 🔐 **Password Variable Expansion**: Fixed admin password not being set in user-seed.conf due to incorrect variable expansion syntax (changed `${ADMIN_PASSWORD}` to `$ADMIN_PASSWORD`)
  - Affected Search Head and ES Search Head UserData scripts
  - Cluster Manager and Indexer scripts also updated for consistency
  - Resolves issue where admin user was created without password

### [1.3.0] - 2025-08-06

#### Fixed
- 🔧 **UserData Script Execution**: Fixed admin user creation timing issue by moving user-seed.conf deletion after admin verification
- 🔄 **Boot-Start Configuration**: Resolved cluster join failures by ensuring proper Splunk stop/start sequence
- 📝 **Documentation Updates**: Updated init.d boot-start configuration documentation

### [1.2.0] - 2025-08-06

#### Added
- 🔒 **HTTPS/TLS Support for HEC**: Implemented SSL/TLS termination at NLB for HEC on port 443
  - Support for ACM certificate (create new or import existing)
  - Updated security groups to allow port 443 traffic
  - Flexible deployment options via context parameters or environment variables
  - Maintains backward compatibility with HTTP on port 8088

#### Changed
- 🔧 **Boot Management System**: Switched from systemd to init.d management (-systemd-managed 0)
  - Resolves permission errors during UserData execution
  - Simplifies deployment in AWS environment
  - Ensures reliable cluster operations and automatic restarts

#### Fixed
- 🛠️ **Splunk Cluster Configuration**: Fixed indexer cluster awareness configuration for Search Heads
  - Connected Search Head to Cluster Manager for cluster management UI
  - Connected ES Search Head to Cluster Manager for status visibility
- 🔄 **ES Installation Reliability**: Improved Enterprise Security installation
  - Removed premature script termination
  - Added proper error handling and retry logic (3 attempts)
  - Implemented Splunk stop/start during installation to avoid conflicts
- ✅ **UserData Script Reliability**: Fixed "splunk is currently running" error preventing cluster configuration

### [1.1.0] - 2025-08-06

#### Added
- 🎫 **Automatic License Installation**: License files placed in licenses/ directory are automatically installed
  - Cluster Manager configured as License Master
  - Indexers and Search Heads configured as license peers
  - Added CloudFormation outputs for license status
- 📋 **License Status Outputs**: Added license verification commands to Search Head stacks
- 📝 **Bilingual Documentation**: Added English documentation to licenses and packages README files

#### Changed
- 🔐 **Non-root User Execution**: All Splunk processes now run as 'splunk' user
  - Created splunk user/group before any Splunk operations
  - Set proper ownership before initial Splunk start
  - All commands use `sudo -u splunk` for security best practices

### [1.0.1] - 2025-08-05

#### Fixed
- 🔧 **Stack Deletion Script**: Improved reliability for stack deletion
  - Extended timeout from 5 to 15 minutes for large stacks
  - Added 5-minute extended monitoring for DELETE_IN_PROGRESS timeouts
  - Implemented dynamic stack existence verification
  - Auto-detect and monitor already deleting stacks

#### Changed
- 📝 **Documentation Updates**: Updated CLAUDE.md with stack deletion script improvements

### [1.0.0] - 2025-08-05

#### Initial Release
- 🏗️ **Multi-AZ Architecture**: Production-ready Splunk Enterprise cluster on AWS
  - 3 Availability Zone deployment for high availability
  - Automated cluster configuration with CDK
  - Splunk Validated Architecture (SVA) best practices implementation
- 🔐 **Security & Compliance**: Enterprise-grade security features
  - AWS Secrets Manager for credential management
  - IAM roles with least privilege principle
  - Private subnet deployment with controlled access
  - Session Manager for secure EC2 access
- 🌐 **Data Ingestion**: Multiple data collection methods
  - Network Load Balancer for S2S (port 9997) and HEC (port 8088)
  - Auto-scaling support for indexer cluster
  - High availability data ingestion endpoints
- 🎯 **Enterprise Features**: Advanced Splunk capabilities
  - Enterprise Security support with dedicated Search Head
  - Cluster Manager (formerly Cluster Master) for centralized management
  - Configurable replication and search factors
  - Support for custom indexes and data models
- 📊 **Cost Optimization**: Budget-conscious design
  - Elastic IP direct access (saves ~$40/month vs ALB)
  - Single NAT Gateway for validation environments
  - M7i instances for better price/performance ratio
- 🔧 **Automation & Operations**: DevOps-friendly deployment
  - Automated UserData scripts for initialization
  - CloudWatch monitoring and logging
  - Systems Manager integration
  - Comprehensive troubleshooting documentation
- 📝 **Documentation**: Complete multilingual support
  - English and Japanese documentation
  - Detailed architecture diagrams
  - Troubleshooting guides
  - Configuration examples
- 🧪 **Validation Environment**: Production-like testing and evaluation
  - Optimized for testing and validation
  - Configurable deployment sizes (Medium/Large) for different scenarios
  - Easy transition path to production environments
- 🚀 **Modern Infrastructure**: Latest AWS services
  - Amazon Linux 2023 support
  - GP3 EBS volumes for better performance
  - VPC with multiple subnet tiers
  - CloudFormation outputs for easy access

---

## Japanese

このプロジェクトの注目すべき変更はすべてこのファイルに記録されます。

フォーマットは[Keep a Changelog](https://keepachangelog.com/ja/1.0.0/)に基づいており、
このプロジェクトは[セマンティックバージョニング](https://semver.org/lang/ja/)に準拠しています。

### [未リリース]

#### 追加
- 🔒 **Search HeadのHTTPSサポート**: すべてのSearch Headインスタンスに自己署名証明書でHTTPSを実装
  - インスタンス初期化時に自動的に自己署名証明書を生成
  - 通常のSearch HeadとES Search Headの両方でポート8443でHTTPS
  - 証明書のCNはインスタンスのパブリックIPに自動設定
  - セキュリティグループルールをポート8443を許可するよう更新
  - CloudFormation出力のWeb UI URLをHTTPSに更新
- 🔑 **対話型デプロイでのAWSプロファイルサポート**: 対話型デプロイウィザードにAWSプロファイル選択機能を追加
  - `aws configure list-profiles`を使用して利用可能なプロファイルを自動検出
  - 特定のプロファイルまたは環境変数の使用を選択可能
  - プロファイルは`--profile`オプションでCDKコマンドに渡される
- ⚡ **自動承認オプション**: CloudFormation変更の自動承認オプションを追加
  - `--require-approval never`オプションの対話型プロンプト
  - CI/CDパイプライン用の無人デプロイメントを可能に
  - 変更が事前レビューされている場合に便利

#### 変更
- 🎯 **デプロイメント構成の簡素化**: 柔軟なインデクサー数設定を固定デプロイメントサイズに置き換え
  - カスタマイズ可能なインデクサー数、レプリケーションファクター、サーチファクターを削除
  - 固定Medium（3インデクサー）およびLarge（6インデクサー）構成を実装
  - 両サイズでRF=3、SF=2でSplunkベストプラクティスを確保
  - 無効な構成を防ぎ、ユーザーエクスペリエンスを向上

### [1.3.1] - 2025年8月7日

#### 修正
- 🔐 **パスワード変数展開**: user-seed.confで管理者パスワードが設定されない問題を修正（変数展開構文を `${ADMIN_PASSWORD}` から `$ADMIN_PASSWORD` に変更）
  - Search HeadとES Search HeadのUserDataスクリプトが影響
  - 一貫性のためCluster ManagerとIndexerスクリプトも更新
  - パスワードなしで管理者ユーザーが作成される問題を解決

### [1.3.0] - 2025年8月6日

#### 修正
- 🔧 **UserDataスクリプト実行**: user-seed.conf削除を管理者確認後に移動して管理者ユーザー作成タイミング問題を修正
- 🔄 **起動時開始設定**: 適切なSplunk停止/開始シーケンスによりクラスター参加失敗を解決
- 📝 **ドキュメント更新**: init.d起動時開始設定のドキュメントを更新

### [1.2.0] - 2025年8月6日

#### 追加
- 🔒 **HEC用HTTPS/TLSサポート**: ポート443でのHEC用NLBでのSSL/TLS終端を実装
  - ACM証明書のサポート（新規作成または既存のインポート）
  - ポート443トラフィックを許可するセキュリティグループを更新
  - コンテキストパラメーターまたは環境変数による柔軟なデプロイメントオプション
  - ポート8088でのHTTPとの後方互換性を維持

#### 変更
- 🔧 **起動管理システム**: systemdからinit.d管理に切り替え（-systemd-managed 0）
  - UserData実行時の権限エラーを解決
  - AWS環境でのデプロイメントを簡素化
  - 信頼性の高いクラスター操作と自動再起動を保証

#### 修正
- 🛠️ **Splunkクラスター設定**: Search Headのインデクサークラスター認識設定を修正
  - クラスター管理UIのためSearch HeadをCluster Managerに接続
  - ステータス可視化のためES Search HeadをCluster Managerに接続
- 🔄 **ESインストールの信頼性**: Enterprise Securityインストールを改善
  - 早期スクリプト終了を削除
  - 適切なエラーハンドリングとリトライロジック（3回試行）を追加
  - 競合を避けるためインストール中にSplunk停止/開始を実装
- ✅ **UserDataスクリプトの信頼性**: クラスター設定を妨げる「splunk is currently running」エラーを修正

### [1.1.0] - 2025年8月6日

#### 追加
- 🎫 **ライセンス自動インストール**: licenses/ディレクトリに配置されたライセンスファイルが自動的にインストールされる
  - Cluster ManagerがLicense Masterとして設定
  - IndexerとSearch Headがライセンスピアとして設定
  - ライセンスステータス用のCloudFormation出力を追加
- 📋 **ライセンスステータス出力**: Search Headスタックにライセンス確認コマンドを追加
- 📝 **バイリンガルドキュメント**: ライセンスとパッケージのREADMEファイルに英語ドキュメントを追加

#### 変更
- 🔐 **非rootユーザー実行**: すべてのSplunkプロセスが'splunk'ユーザーで実行されるように
  - Splunk操作前にsplunkユーザー/グループを作成
  - 初回Splunk起動前に適切な所有権を設定
  - セキュリティベストプラクティスのためすべてのコマンドが`sudo -u splunk`を使用

### [1.0.1] - 2025年8月5日

#### 修正
- 🔧 **スタック削除スクリプト**: スタック削除の信頼性を改善
  - 大規模スタック用にタイムアウトを5分から15分に延長
  - DELETE_IN_PROGRESSタイムアウト用に5分の延長監視を追加
  - 動的スタック存在確認を実装
  - 既に削除中のスタックを自動検出して監視

#### 変更
- 📝 **ドキュメント更新**: スタック削除スクリプトの改善でCLAUDE.mdを更新

### [1.0.0] - 2025年8月5日

#### 初回リリース
- 🏗️ **マルチAZアーキテクチャ**: AWS上の本番対応Splunk Enterpriseクラスター
  - 高可用性のための3つの可用性ゾーンデプロイメント
  - CDKによる自動化されたクラスター設定
  - Splunk Validated Architecture (SVA)ベストプラクティスの実装
- 🔐 **セキュリティとコンプライアンス**: エンタープライズグレードのセキュリティ機能
  - 認証情報管理用のAWS Secrets Manager
  - 最小権限原則によるIAMロール
  - 制御されたアクセスによるプライベートサブネットデプロイメント
  - 安全なEC2アクセス用のSession Manager
- 🌐 **データ取り込み**: 複数のデータ収集方法
  - S2S（ポート9997）とHEC（ポート8088）用のNetwork Load Balancer
  - インデクサークラスターのオートスケーリングサポート
  - 高可用性データ取り込みエンドポイント
- 🎯 **エンタープライズ機能**: 高度なSplunk機能
  - 専用Search HeadによるEnterprise Securityサポート
  - 集中管理用のCluster Manager（旧Cluster Master）
  - 設定可能なレプリケーションとサーチファクター
  - カスタムインデックスとデータモデルのサポート
- 📊 **コスト最適化**: 予算を意識した設計
  - Elastic IP直接アクセス（ALBと比較して月額約$40節約）
  - 検証環境用の単一NAT Gateway
  - より良い価格/性能比のためのM7iインスタンス
- 🔧 **自動化と運用**: DevOpsフレンドリーなデプロイメント
  - 初期化用の自動化されたUserDataスクリプト
  - CloudWatch監視とロギング
  - Systems Manager統合
  - 包括的なトラブルシューティングドキュメント
- 📝 **ドキュメント**: 完全な多言語サポート
  - 英語と日本語のドキュメント
  - 詳細なアーキテクチャ図
  - トラブルシューティングガイド
  - 設定例
- 🧪 **検証環境**: 本番環境に似たテストと評価
  - テストと検証用に最適化
  - 異なるシナリオ用の設定可能なデプロイメントサイズ（Medium/Large）
  - 本番環境への簡単な移行パス
- 🚀 **モダンインフラストラクチャ**: 最新のAWSサービス
  - Amazon Linux 2023サポート
  - より良いパフォーマンスのためのGP3 EBSボリューム
  - 複数のサブネット層を持つVPC
  - 簡単なアクセスのためのCloudFormation出力