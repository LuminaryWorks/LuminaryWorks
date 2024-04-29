# LuminaryWorks 多产品会员与授权体系设计方案

## 1. 背景

LuminaryWorks 旗下产品：

-   DataLuminary（BI 数据分析平台）
-   BlockyEdu（AI 教育平台）
-   VistaRemote（远程控制平台）

未来模式：

-   ToC 用户：个人注册、免费试用、Pro 会员
-   ToB 用户：企业 SaaS 套餐
-   私有化部署：企业 License 授权
-   联合会员：与第三方企业合作（例如京东、喜马拉雅等）

因此不能简单设计成单个产品会员系统，需要设计统一的：

> Identity（身份） + Tenant（组织） + Subscription（订阅） +
> Entitlement（权益）

体系。

------------------------------------------------------------------------

# 2. 统一 Luminary Account

不要每个产品维护独立账号。

类似：

-   Adobe ID
-   Microsoft Account
-   Atlassian Account

架构：

    Luminary Account

            |
            |
      -----------------
      |       |       |
    DataLuminary BlockyEdu VistaRemote

用户注册一次：

    zhou@example.com

    DataLuminary:
    Trial expired

    BlockyEdu:
    Pro

    VistaRemote:
    Free

------------------------------------------------------------------------

# 3. Subscription 设计

不要设计：

    data_luminary_member
    blockyedu_member
    vistaremote_member

应该统一：

    subscription

示例：

    subscription

    id

    user_id

    plan_id

    status

    start_at

    end_at

    source

例如：

    User:
    zhou@example.com

    Subscription:
    DataLuminary Pro

    Status:
    active

------------------------------------------------------------------------

# 4. Product 与 Plan 分离

## Product

    product

    id

    name

    code

示例：

  Product
  --------------
  DataLuminary
  BlockyEdu
  VistaRemote

## Plan

    plan

    id

    product_id

    name

    type

例如：

  产品           套餐
  -------------- ------------
  DataLuminary   Free
  DataLuminary   Pro
  DataLuminary   Enterprise
  BlockyEdu      Free
  BlockyEdu      Pro
  VistaRemote    Team

------------------------------------------------------------------------

# 5. Entitlement 权益系统

不要使用：

    if(user.vip)

应该：

    User

    ↓

    Subscription

    ↓

    Entitlement

    ↓

    Feature

------------------------------------------------------------------------

## Feature

统一功能定义：

    feature

    id

    code

例如：

    dashboard.export

    ai.analysis

    storage.size

    device.limit

------------------------------------------------------------------------

## Entitlement

    entitlement

    subscription_id

    feature_id

    value

例如：

DataLuminary Pro：

    dashboard.limit = 50

    export_pdf = true

    storage = 50GB

BlockyEdu：

    course.ai_teacher

    student.limit

VistaRemote：

    device.limit

    remote.control

    recording

------------------------------------------------------------------------

# 6. 免费试用 Trial 设计

> 本节是通用设计输入，不覆盖产品级 `trialPolicy`。DoerFlow 固定为 `disabled`：
> 不创建 Trial，不展示免费试用 CTA 或倒计时，只提供 Pro / Ultra / Enterprise。
> 权威契约见 `spec/subscription-and-entitlement.md`。

不要特殊处理。

创建 Trial Plan：

    DataLuminary Trial

    duration:
    7 days

注册时：

自动创建：

    subscription

    user:
    123

    plan:
    DataLuminary Trial

    start:
    2026-07-28

    end:
    2026-08-04

7 天后：

    expired

权限系统返回：

    Need upgrade

------------------------------------------------------------------------

# 7. 企业用户设计

企业不是 User。

需要：

    User

    Tenant

    Membership

例如：

    Tenant:

    Tencent

    Users:

    张三
    李四
    王五

关系：

    tenant_member

    tenant_id

    user_id

    role

------------------------------------------------------------------------

企业套餐：

不是：

    user subscription

而是：

    tenant subscription

例如：

    Tencent

    Plan:
    DataLuminary Enterprise

    Seat:
    500

    Expire:
    2027-01-01

用户访问时：

检查：

    个人权益

    +

    组织权益

------------------------------------------------------------------------

# 8. 私有化部署设计

私有化通常不走 SaaS Billing。

例如：

    中国银行

    部署：

    bank.local

    DataLuminary Server

授权：

    license.json

示例：

``` json
{
  "product":"DataLuminary",
  "edition":"Enterprise",
  "expire":"2027-01-01",
  "users":5000
}
```

系统：

    License Service

    ↓

    验证 License

    ↓

    开放功能

------------------------------------------------------------------------

# 9. 联合会员设计

不要硬编码：

    京东会员 = DataLuminary会员

应该设计 Partner Benefit。

------------------------------------------------------------------------

## Partner

    partner

    id

    name

例如：

    LuminaryWorks

    JD

    Ximalaya

------------------------------------------------------------------------

## Partner Benefit

例如：

    JD PLUS

    Benefit:

    DataLuminary Pro
    30 days

绑定后：

生成：

    subscription

    source:
    JD

系统统一认为：

    DataLuminary Pro active

------------------------------------------------------------------------

# 10. 推荐整体架构

                     Luminary Account

                           |

                     IAM Service

                           |

                 Subscription Service

                           |

                 Entitlement Service

                           |

     -----------------------------------

     |                |                |

    DataLuminary   BlockyEdu    VistaRemote


                           |

                    Tenant Service


                           |

                     Enterprise


                           |

                    License Service

------------------------------------------------------------------------

# 11. 权限判断流程

用户打开 DataLuminary：

    Request

    ↓

    Auth

    ↓

    Get User

    ↓

    Check Tenant

    ↓

    Check Subscription

    ↓

    Get Entitlements

    ↓

    Allow / Deny

例如：

    个人:

    DataLuminary Trial expired


    但是：

    公司 Tenant:

    Tencent Enterprise


    结果:

    ALLOW

------------------------------------------------------------------------

# 12. 分阶段实现建议

## 第一阶段 MVP

实现：

    Luminary Account

    Product

    Plan

    Subscription

    Feature

    Entitlement

支持：

-   Free
-   Trial 7 天
-   Pro

------------------------------------------------------------------------

## 第二阶段

增加：

    Tenant

    Organization

    Enterprise Plan

支持：

-   企业 SaaS
-   团队账号

------------------------------------------------------------------------

## 第三阶段

增加：

    Partner Benefit

支持：

-   京东会员
-   喜马拉雅会员
-   第三方积分兑换

------------------------------------------------------------------------

# 13. 最终定位

LuminaryWorks 不应该做简单会员中心。

应该建设：

## LuminaryWorks Identity & Entitlement Platform

类似：

-   Microsoft Entra + Licensing
-   AWS IAM + Organizations
-   Atlassian Cloud Admin

未来：

DataLuminary、BlockyEdu、VistaRemote 都只是授权资源提供方。

新增更多产品时，不需要重新设计会员系统。
