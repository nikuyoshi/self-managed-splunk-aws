# Self-Managed Splunk on AWS - プロジェクト概要

## 🎯 プロジェクトの目的
**本プロジェクトは、本番環境を想定した検証環境（Production-Like Validation Environment）として設計されています。**

Splunk Enterpriseのクラスター構成を自分のAWSアカウント上で構築し、以下の用途で活用します：
- 本番環境と同等の構成でSplunk設定を事前検証
- パフォーマンステストとキャパシティプランニング
- 運用チームのトレーニングとスキル向上
- Enterprise Securityの実装評価
- 新機能や設定変更の安全な検証

Splunk Validated Architecture (SVA)を参考に、AWS CDKを活用して本番品質の自動化されたデプロイメントを実現します。

> **⚠️ 注意**: 検証環境として最適化されているため、一部コスト削減設定（単一NAT Gateway等）が含まれています。本番環境への移行時はREADME.mdの「本番環境への移行」セクションを参照してください。

## 参考資料
- [Splunk Cloud Platform Experience Architecture](https://docs.splunk.com/Documentation/SVA/current/Architectures/SCPExperience)
- [nikuyoshi/splunk-core-aws](https://github.com/nikuyoshi/splunk-core-aws) - シングルインスタンスのSplunk Enterprise実装

## 設計方針（SVAとnikuyoshi実装からの学び）

### Splunk Cloud Platform Experienceからの重要な要素
1. **高可用性設計**
   - すべてのコンポーネントを3つのAvailability Zoneに分散配置
   - 自動フェイルオーバー機能によるAZ障害時の継続的なサービス提供
   - クライアント側とサーバー側の両方でロードバランシング実装

2. **データ取り込みアーキテクチャ**
   - S2S (Splunk-to-Splunk): TCP 9997でのセキュアなデータ転送
   - HEC (HTTP Event Collector): HTTPS 443での安全なイベント収集
   - すべての転送データはデフォルトで暗号化

3. **セキュリティベストプラクティス**
   - ファイアウォール保護されたエンドポイント
   - 設定可能なIPアローリスト
   - Enterprise Managed Encryption Keys (EMEK)オプション

### nikuyoshi/splunk-core-awsからの実装パターン
1. **CDK実装のベストプラクティス**
   - VPCとプライベートサブネット配置によるセキュアな構成
   - Application Load Balancerによるパブリックアクセス制御
   - AWS Secrets Managerでの認証情報の安全な管理
   - EC2 UserDataによるSplunkの自動インストールと設定

2. **クラスター対応への拡張ポイント**
   - Auto Scaling Groupを使用した複数インスタンスの管理
   - 内部通信用のセキュリティグループ設計
   - クラスター固有のポート開放（レプリケーション用）

## アーキテクチャ設計

### 主要コンポーネント

#### 1. ネットワーク層
- **VPC**: 10.0.0.0/16 CIDR
- **可用性ゾーン**: 3AZ構成（高可用性のため）
- **サブネット構成**:
  - パブリックサブネット: 各AZに1つ（Elastic IP付きインスタンス用）
  - プライベートサブネット: 各AZに1つ（Splunkインスタンス用）
  - データサブネット: 各AZに1つ（将来的なデータストレージ用）

#### 2. Indexerクラスター
- **配置**: 3つのAZに分散配置（最小3ノード）
- **インスタンスタイプ**: m7i.xlarge（M5比で1.75-2.2倍の性能向上、コスト増は5%）
- **ストレージ**: 
  - ホットパス: EBS GP3ボリューム（500GB）- 高速検索用
  - コールドパス: EBS GP3ボリューム（1TB）- アーカイブ用
  - 暗号化: デフォルトで有効
- **レプリケーション**: 
  - レプリケーションファクター: 3（各データを3ノードに複製）
  - サーチファクター: 2（検索可能なコピー数）
- **ポート**: 
  - 9997: Splunk to Splunk (S2S) データ受信
  - 8089: 管理ポート
  - 9100-9300: クラスター内レプリケーション

#### 3. Search Head
##### 3-1. 通常Search Head
- **構成**: 初期は単一Search Head（将来的にクラスター化）
- **インスタンスタイプ**: m7i.large（高速検索処理）
- **配置**: プライベートサブネット
- **ポート**: 8000 (Web UI)
- **用途**: 通常の検索・分析作業

##### 3-2. Enterprise Security (ES) 専用Search Head
- **構成**: 単一の専用Search Head（ESはクラスター非推奨）
- **インスタンスタイプ**: m7i.2xlarge（ESの高負荷に対応、DDR5メモリ）
- **配置**: プライベートサブネット
- **ポート**: 8000 (Web UI)
- **メモリ**: 最小16GB RAM（推奨32GB）
- **ストレージ**: 
  - システム: 100GB GP3
  - データモデル高速化用: 500GB GP3（別ボリューム）
- **特別な要件**:
  - データモデル高速化の有効化
  - KVStore レプリケーション設定
  - ES専用インデックスへのアクセス権限

#### 4. クラスターマスター（Cluster Manager）
- **役割**: Indexerクラスターの管理、レプリケーションファクターとサーチファクターの管理
- **インスタンスタイプ**: m7i.large（管理処理の高速化）
- **配置**: プライベートサブネット（単一インスタンス）
- **重要**: Splunk 8.2以降では「Cluster Manager」に名称変更

#### 5. 外部アクセス
- **Elastic IP**: 各Search Headに直接割り当て
- **アクセス方法**:
  - 通常Search Head: Elastic IP:8000
  - ES Search Head: 別のElastic IP:8000
- **コスト削減**: ALBより約$40/月節約
- **注意**: 単一インスタンス構成に適している

#### 6. データ取り込み
- **S2S (Splunk to Splunk)**: 
  - ポート: TCP 9997
  - Network Load Balancer経由でIndexerに分散
  - TLS暗号化対応
- **HEC (HTTP Event Collector)**: 
  - HTTP: ポート8088（デフォルト）
  - HTTPS: ポート443（SSL/TLS終端、ACM証明書使用）
  - トークンベース認証
  - NLBでのSSL終端により本番環境のセキュリティを確保
- **セキュリティグループ**: 
  - IPアローリストによるアクセス制限
  - 最小権限の原則に基づく設定

#### 7. Enterprise Security用インデックス
- **必須インデックス**:
  - `main`: 基本イベントデータ
  - `summary`: サマリーインデックス
  - `risk`: リスクスコアリング用
  - `notable`: Notable Events用
  - `threat_intel`: 脅威インテリジェンス
- **推奨インデックス**:
  - セキュリティデータソース別（firewall, proxy, endpoint等）
- **データモデル**:
  - Authentication
  - Network Traffic
  - Web
  - Endpoint
  - その他ES必須データモデル

### セキュリティ設計

#### 1. ネットワークセキュリティ
- セキュリティグループによるアクセス制御
- NACLによる追加の保護層
- プライベートサブネットへの配置

#### 2. 認証・認可
- AWS Secrets Managerでの認証情報管理
- IAMロールベースのアクセス制御
- SSM Session Managerでの安全なアクセス

#### 3. データ保護
- EBS暗号化（デフォルト）
- 転送中のデータ暗号化（TLS）
- S3バックアップ（オプション）

### 実装フェーズ

#### フェーズ1: 基本インフラストラクチャ
1. VPCとネットワーク構成
2. セキュリティグループの設定（階層的設計）
3. IAMロールとポリシー（最小権限）
4. Secrets Managerの準備

#### フェーズ2: Splunkコンポーネント
1. Cluster Manager（旧クラスターマスター）のデプロイ
2. Indexerクラスターの構築（3ノード、各AZに1つ）
3. クラスター初期設定（レプリケーション・サーチファクター）
4. 通常Search Headのデプロイ
5. ES専用Search Headのデプロイ
6. Elastic IPの割り当て

#### フェーズ3: データ取り込み設定とES設定
1. S2Sエンドポイントの設定（NLB経由）
2. HECの有効化と設定（トークン生成）
3. TLS証明書の設定
4. ES用インデックスの作成
5. ESアプリケーションのインストールと初期設定
6. データモデルの高速化設定
7. データ取り込みテスト

#### フェーズ4: 運用機能
1. CloudWatchモニタリングとアラーム設定
2. EBSスナップショットによるバックアップ
3. Systems Manager Session Managerの設定
4. ログ転送設定（CloudWatch Logs）

## コンポーネント最新化戦略

### デプロイ時の最新化アプローチ
CDKデプロイ時にすべてのコンポーネントが最新バージョンとなるよう、以下の戦略を採用：

1. **OS/AMIの最新化**
   - Amazon Linux 2023の最新AMIを動的に取得
   - Systems Manager Parameter Storeから最新AMI IDを取得
   - EC2 Image Builderによるカスタムイメージの自動ビルド（オプション）

2. **Splunkバージョンの最新化**
   - Splunkダウンロードページから最新バージョンを取得するスクリプト
   - Parameter StoreまたはSecrets Managerでバージョン管理
   - UserDataでの動的ダウンロード実装

3. **パッケージ/依存関係の最新化**
   - UserData実行時に`yum update -y`を実行
   - 必要なパッケージは最新版をインストール
   - CloudWatch AgentやSSM Agentの最新版を使用

4. **自動更新メカニズム**
   - Systems Manager Patch Managerによる定期的なOS更新
   - Lambda関数による最新バージョンチェック（オプション）
   - CloudFormation Stack更新時の自動リプレイス設定

### 実装例
```typescript
// 最新AMIの取得
const latestAmiId = ec2.MachineImage.latestAmazonLinux2023({
  generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023,
  cpuType: ec2.AmazonLinuxCpuType.X86_64,
});

// Splunk最新バージョンの動的取得
const splunkVersion = new ssm.StringParameter(this, 'SplunkLatestVersion', {
  parameterName: '/splunk/latest-version',
  stringValue: '9.2.0', // デフォルト値
});

// UserDataでの動的インストール
userData.addCommands(
  'SPLUNK_VERSION=$(aws ssm get-parameter --name /splunk/latest-version --query Parameter.Value --output text)',
  'wget -O splunk.tgz "https://download.splunk.com/products/splunk/releases/${SPLUNK_VERSION}/linux/splunk-${SPLUNK_VERSION}-Linux-x86_64.tgz"'
);
```

## CDK実装方針

### プロジェクト構造
```
self-managed-splunk-aws/
├── bin/
│   └── self-managed-splunk-aws.ts    # CDKアプリケーションエントリポイント
├── lib/
│   ├── network-stack.ts              # VPC、サブネット、セキュリティグループ
│   ├── splunk-cluster-stack.ts       # Indexerクラスター、クラスターマスター
│   ├── splunk-search-stack.ts        # 通常Search Head、Elastic IP
│   ├── splunk-es-stack.ts            # Enterprise Security Search Head
│   └── splunk-data-ingestion-stack.ts # データ取り込み設定
├── config/
│   └── splunk-config.ts              # Splunk設定パラメータ
└── scripts/
    └── user-data/                    # EC2 UserDataスクリプト
        ├── indexer-init.sh           # Indexer初期化スクリプト
        ├── search-head-init.sh       # Search Head初期化スクリプト
        └── es-search-head-init.sh    # ES Search Head初期化スクリプト
```

### 主要な実装パターン

#### 1. VPC作成（network-stack.ts）
```typescript
const vpc = new ec2.Vpc(this, 'SplunkCloudVpc', {
  maxAzs: 3,
  ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
  subnetConfiguration: [
    {
      cidrMask: 24,
      name: 'Public',
      subnetType: ec2.SubnetType.PUBLIC,
    },
    {
      cidrMask: 24,
      name: 'Private',
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    },
    {
      cidrMask: 24,
      name: 'Data',
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
    }
  ]
});
```

#### 2. Indexerインスタンス作成
```typescript
// Auto Scaling Groupを使用して3AZに分散
const indexerAsg = new autoscaling.AutoScalingGroup(this, 'IndexerASG', {
  vpc,
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.M7I, ec2.InstanceSize.XLARGE),
  machineImage: ec2.MachineImage.latestAmazonLinux2(),
  minCapacity: 3,
  maxCapacity: 3,
  desiredCapacity: 3,
  vpcSubnets: {
    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    onePerAz: true
  }
});
```

#### 3. セキュリティグループ設計
```typescript
// Splunkクラスター内部通信用
const clusterSg = new ec2.SecurityGroup(this, 'SplunkClusterSG', {
  vpc,
  description: 'Splunk cluster internal communication',
  allowAllOutbound: true
});

// クラスター内通信を許可
clusterSg.addIngressRule(clusterSg, ec2.Port.tcp(8089), 'Splunk management port');
clusterSg.addIngressRule(clusterSg, ec2.Port.tcp(9997), 'Splunk S2S port');
clusterSg.addIngressRule(clusterSg, ec2.Port.tcpRange(9100, 9300), 'Splunk replication ports');
```

#### 4. Elastic IP設定
```typescript
// Search Head用Elastic IP
const eip = new ec2.CfnEIP(this, 'SearchHeadEIP', {
  domain: 'vpc',
  tags: [{
    key: 'Name',
    value: `${this.stackName}-SearchHead-EIP`,
  }],
});

// Elastic IPをインスタンスに関連付け
new ec2.CfnEIPAssociation(this, 'SearchHeadEIPAssoc', {
  allocationId: eip.attrAllocationId,
  instanceId: this.searchHead.instanceId,
});

// ダイレクトアクセスを許可
this.searchHead.connections.allowFromAnyIpv4(
  ec2.Port.tcp(8000),
  'Allow Splunk Web UI access'
);
```

#### 5. Secrets Manager統合
```typescript
const splunkAdminPassword = new secretsmanager.Secret(this, 'SplunkAdminPassword', {
  description: 'Splunk admin password',
  generateSecretString: {
    passwordLength: 16,
    excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
  },
});

// EC2インスタンスにSecrets Manager読み取り権限を付与
splunkAdminPassword.grantRead(instance.role);
```

### 環境変数とパラメータ
```typescript
interface SplunkCloudConfig {
  // ネットワーク設定
  vpcCidr: string;
  maxAzs: number;
  
  // インスタンス設定
  indexerInstanceType: string;
  searchHeadInstanceType: string;
  esSearchHeadInstanceType: string; // ES専用Search Head
  clusterMasterInstanceType: string;
  
  // Splunk設定
  splunkVersion: string;
  splunkDownloadUrl: string;
  enableEnterpriseSecurity: boolean;
  esVersion?: string; // ESのバージョン
  
  // セキュリティ設定
  allowedIpRanges: string[];
  enableEncryption: boolean;
  
  // ES設定
  esIndexes?: string[]; // カスタムインデックス
  esDataModelAcceleration: boolean; // データモデル高速化
}
```

## 開発ガイドライン

### AWS認証設定
デプロイ前にAWS認証情報を設定する必要があります。

#### AWS SSO（推奨）を使用する場合
```bash
# SSO設定を確認
aws configure list

# 認証情報がない場合、SSOログイン
aws sso login --profile <your-profile-name>

# プロファイルを環境変数に設定
export AWS_PROFILE=<your-profile-name>

# または、デフォルトプロファイルとして設定
aws configure set sso_session <your-sso-session>
```

#### IAMユーザーの認証情報を使用する場合
```bash
# AWS認証情報を設定
aws configure
# Access Key ID、Secret Access Key、リージョンを入力
```

### コマンド
```bash
# 依存関係のインストール
npm install

# TypeScriptのビルド
npm run build

# AWS認証確認（デプロイ前に実行推奨）
aws sts get-caller-identity

# 環境変数の設定（オレゴンリージョン推奨）
export AWS_REGION=us-west-2
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=$AWS_REGION

# CDKスタックのデプロイ
npx cdk deploy --all

# 特定のプロファイルでデプロイ
npx cdk deploy --all --profile <your-profile-name>

# Enterprise Security有効化してデプロイ
npx cdk deploy --all --context enableES=true

# テストの実行
npm test

# リンターの実行
npm run lint

# 型チェック
npm run typecheck

# スタックの削除（依存関係を考慮した自動削除）
./scripts/destroy-all-stacks.sh --profile <your-profile-name>
```

### ベストプラクティス
1. すべてのリソースにタグを付ける
2. コスト管理のためのCloudWatchアラーム設定
3. セキュリティグループは最小権限の原則に従う
4. パスワードや認証情報はSecrets Managerで管理
5. ログはCloudWatch Logsに集約

### 注意事項
- Splunk Enterpriseのライセンスが必要（60日間の試用版あり）
- Enterprise Securityは別途ライセンスが必要
- 本番環境では適切なインスタンスサイズを選択（データ量に応じて調整）
- ES Search Headは高負荷のため、十分なリソースを確保
- データ保持ポリシーを事前に決定（ホット/コールド/アーカイブ）
- ネットワーク帯域幅の要件を考慮（特にレプリケーション）
- Cluster Managerは単一障害点となるため、定期的なバックアップが重要
- Indexerノードの追加・削除時はクラスターの再バランスが必要
- ESのデータモデル高速化は大量のストレージを消費するため計画的に実施

### 最近の改善
- **Search Headのインデクサークラスター認識設定**: Search HeadをCluster Managerに接続し、クラスター管理機能とステータス可視化を有効化
- **ES Installation改善**: エラーハンドリング強化、Splunk停止/起動による競合回避、リトライロジック追加
- **Cluster設定の信頼性向上**: Cluster Manager/Indexer設定後の検証ステップ追加、エラー時の継続処理実装
- **Indexerクラスター参加の信頼性向上**: UserDataスクリプトにCluster Manager待機ロジック（最大5分）と3回リトライメカニズムを実装
- **Elastic IPアーキテクチャ**: ALBを廃止しElastic IPによる直接アクセスに変更（月額約$40削減）
- **トラブルシューティング強化**: CloudFormation出力に詳細なトラブルシューティングガイドを追加
- **Network Load Balancerによるデータ取り込み**: S2S（ポート9997）とHEC（ポート8088）用のNLBを実装し、データ取り込みの高可用性を実現
- **Search Head分散検索の自動設定**: UserDataスクリプトで全Indexerを自動的に検出・追加する機能を実装（最大10分待機）
- **セキュリティグループの改善**: レプリケーションポート範囲を9000-9999に拡張し、カスタムポート設定に対応
- **ES Search Headへの分散検索機能追加**: Enterprise Security用Search Headにも同じ分散検索自動設定機能を実装
- **分散検索スクリプトのバグ修正**: grep -cコマンドの複数行出力による整数比較エラーを修正（head -1 | tr -d '\n'で処理）
- **UserDataエラーハンドリングの改善**: set +e/set -eによるエラー制御とコマンド出力による成功判定を実装し、スクリプトの完全実行を保証
- **HEC設定の強化**: ディレクトリ作成の確実化とCLIコマンドによる追加設定で、HECの確実な有効化を実現
- **セキュリティグループへのHECポート追加**: ポート8088を明示的に許可し、HECエンドポイントへの接続性を改善
- **splunkユーザーでの実行**: セキュリティベストプラクティスに従い、Splunkを非rootユーザー（splunk）で実行するよう全スタックを更新
- **ライセンス自動インストール機能**: licenses/ディレクトリに配置したライセンスファイルを自動的にインストールし、Cluster Managerをライセンスマスターとして設定

### 検証環境としての利用
このプロジェクトは検証環境として以下の用途で活用できます：
- Splunk設定の事前検証とテスト
- パフォーマンス測定とキャパシティプランニング
- 運用チームのトレーニングとスキル向上
- Enterprise Securityの機能評価
- カスタムアプリケーションの開発・テスト

## 今後の拡張計画
1. Search Headクラスターの実装
2. License Serverの追加
3. Deployment Serverの実装
4. マルチサイトクラスタリング
5. AWS Backupとの統合
6. CloudFormationカスタムリソースの活用

## Git Commit Rules
1. **DO NOT add Co-Authored-By lines** - Clean commit messages only
2. **DO NOT add "🤖 Generated with Claude Code" footer** - Keep commits clean
3. **DO NOT mention Claude in commit messages** - User is the primary author