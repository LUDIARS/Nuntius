---
type: feature
title: Nuntius obsolete and Conexus succession
service: nuntius
status: obsolete
updated: 2026-10-18
---

# Nuntius の正式な廃止扱い

決定者: neco。根拠: 2026-10-18「Conexusつくる」「Nuntiusもこれで置き換えるのでNuntiusを正式にobsoleteにする」。

Nuntius は obsolete とし、新規採用と新機能追加を終了する。外部サービスとの BOT 連携は Conexus (Nx) が後継となる。Conexus は Discord / LINE 等との双方向通信、接続トークンによる明示認可、入口と出口の共通検疫を所有する。

LUDIARS の一覧には2026-09-15付のobsolete記載が既にあり、通知の共通化先はLapilliとされていた。今回の決定では、BOT接続と検疫をConexusへ集約することを明示する。発信元の業務判断やテンプレートまでConexusの責務としない。

## 状態の区別

- 廃止扱いの決定: 本文とREADME/作業規則へ明記。
- 後継実装: Conexus の作業ブランチで開発中。完成・稼働・全利用者切替を意味しない。
- Nuntius の停止・削除: この変更には含めない。データ、queue、credentialを保持する。

## 移行受入

1. 発信元、宛先、チャネル、template、schedule、subscription、添付、未処理queueを棚卸しする。秘密値を台帳へ載せない。
2. Conexusにservice/route/operation/actorの明示許可と期限つきtokenを設定する。Nuntiusのtokenをそのまま流用しない。
3. Discord/LINEは隔離宛先で双方向・署名・検疫・失効・再送・障害復旧を確認する。Email/SMS/Alexa/WebPush等は実利用と移行先を個別確認する。
4. Nuntius旧配送をrouteごとに止め、queueをdrainまたは保留して照合し、新経路へ切り替える。同一メッセージの二重送信を避ける。
5. 全利用者の移行、未処理配送ゼロ、保存義務と復元手順を確認してから停止を判断する。停止はExcubitorから行い、データ削除や外部repo archiveは別判断。

Conexusに未対応の機能があればその利用者は移行待ちとする。テキストBOT配送の確認だけでNuntiusの全機能を置換済みと報告しない。

## 保守方針

移行と安全上の修正・既存利用者の障害対応のみ許容。新規サービスがNuntiusを依存先に追加することは禁止。既存APIを急に削除せず、利用者の切替と同時に廃止する。
