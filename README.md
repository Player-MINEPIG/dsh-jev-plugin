# Jev 共享决策服务（中文 fork）

此 fork 基于 [RaulLazaro/dsh-jev-plugin](https://github.com/RaulLazaro/dsh-jev-plugin)，保留 MIT 许可证和原作者署名。它提供 `jev` 工具、中文设置页和共享服务 `ctx.decisionModels.ask()`。任务系统、消息插件等调用方可以共享这里的配置，不必各自保存 URL 与密钥。

相比原版，此 fork 增加共享服务、配置档案、DSH 普通模型调用、模型目录选择、推理强度选择、严格 JSON 解析、取消与卸载处理。本轮补齐中文界面与帮助，并校验完整的 `choice` 概率分布。具体基线见 [UPSTREAM.md](UPSTREAM.md)。

## 配置调用方式

打开 **设置 → JEV 决策**，选择以下一种方式。

### 使用 System One 服务或统一路由

1. 选择内置提供商，或选择“自定义 TypeSafe 兼容端点”。
2. 自定义模式填写完整请求 URL，例如 `https://router.example/v1/systemone`。插件使用该地址，不追加路径。
3. 填写路由支持的模型 ID。留空时使用提供商默认模型。
4. 点击“保存密钥”。密钥保存在 DSH 凭据存储中，不写入 `settings.yaml`。
5. 点击“保存设置”，再点击“测试连接”。测试会发起真实请求，并显示提供商、模型、耗时、用量和答案。

对于已支持 `/v1/systemone` 的 yetone/magpie，直接使用 `custom` 配置。此插件不另建路由，也不把聊天接口当作 System One 接口。

请求使用 `Authorization: Bearer <key>`，JSON 请求体为 `{model, state, questions}`，响应包含 `answers`。Laya 默认模型为空时省略 `model` 字段。

| 提供商 ID | 请求 URL | 默认模型 | 凭据名称及同名环境变量 |
| --- | --- | --- | --- |
| `typesafe` | `https://api.typesafe.ai/v1/systemone` | `jev-latest` | `TYPESAFE_API_KEY` |
| `vercel-gateway` | `https://ai-gateway.vercel.sh/typesafe/v1/systemone` | `typesafe-ai/jev` | `AI_GATEWAY_API_KEY` |
| `laya-studio` | `https://api.laya.studio/v1/systemone` | 自动路由 | `LAYA_API_KEY` |
| `opencode-zen` | `https://opencode.ai/zen/v1/systemone` | `jev-1.13` | `OPENCODE_ZEN_API_KEY` |
| `custom` | 用户填写的完整地址 | `jev-latest` | `JEV_API_KEY` |
| `native` | 由 DSH 提供商管理 | 用户从目录选择 | 由 DSH 模型设置管理 |

切换提供商时分别解析对应凭据。保存密钥以界面当前所选提供商为目标，即使提供商设置尚未保存。密钥解析顺序为 DSH 凭据存储、旧版 `apiKey` 设置值、同名环境变量。读取各来源时去除首尾空白；空白或非字符串值视为未配置，继续检查下一个来源。不要在配置文件中新增明文密钥。

内置提供商的限制仍然生效。例如 Laya 每次最多 32 个问题、每题最多 64 个选项，且可能截断较长输入。价格、上下文长度和模型可用性以提供商为准。各服务的概率和置信度算法可能不同，阈值不能直接沿用。

### 使用普通 DSH 模型

1. 选择“DSH 普通模型”。
2. 从目录选择已注册的 DSH 提供商和模型。
3. 按模型目录提供的选项设置推理强度，或保留提供商默认值。
4. 保存设置并测试连接。

该模式调用 `ctx.llm.prepareCall()`，复用 DSH 的适配器、连接与凭据。插件把同一份 `state` 和 `questions` 发送给普通模型，用提示词要求模型输出 `{answers:{问题ID:答案}}`，再通过与 System One 路径共用的校验器解析结果。不会创建 Agent、会话或执行工具，也不是手工填写 JSON 的编辑器。

普通模型必须遵循 JSON 协议。模型输出解释、Markdown 代码围栏、重复字段、遗漏答案、不完整概率或截断响应时，调用失败。插件不会猜测缺失字段、补零、重归一化或静默切换模型。

## 共享服务与工具

依赖 `decisionModels` 服务即可复用默认配置。`jev` 工具和设置页连接测试也使用同一个服务。

```js
export const inject = ['decisionModels']

export async function apply(ctx) {
  const result = await ctx.decisionModels.ask({
    state: '新消息：感谢，问题已经解决。',
    questions: {
      reply: {
        type: 'choice',
        instructions: '选择下一步处理方式。',
        criteria: {
          ignore: '无需回复',
          draft: '准备回复草稿',
          human: '需要用户处理',
        },
      },
    },
  }, {signal: new AbortController().signal})
  // result 为 {provider, model, answers, usage?}；失败时 Promise 拒绝。
  // 调用方根据实际任务决定是否执行、重试或转人工处理。
}
```

`provider`、`model` 和 `reasoningEffort` 可在请求中覆盖默认值。`provider` 也接受 `profiles` 中的档案 ID。`ctx.decisionModels.config()` 返回当前配置的副本，供调用方展示可用档案。类型声明位于 `lib/index.d.ts`。协议字段、服务标识、错误码、模型 ID 和用户自定义名称保留原值。

服务可在没有 `tools` 服务时挂载。每次调用支持 `AbortSignal`；超时或插件卸载会中止等待中的调用。普通模型路径禁用工具调用，使用 DSH 返回的文本块，不把推理块当作答案。

## 答案格式与概率限制

`state` 为非空字符串，`questions` 为以问题 ID 为键的对象。`instructions` 必须为非空字符串。`answers` 必须恰好对应所有问题 ID，每项 `type` 与原问题一致。

| 类型 | 问题要求 | 答案 |
| --- | --- | --- |
| `noul` | `instructions`，可带 `criteria.true` 与 `criteria.false` | `{type:"noul",noul:0.8}`，`noul` 为 0..1 的有限数值 |
| `choice` | `criteria` 为至少两个选项 ID 到描述的对象 | `{type:"choice",choice:"ignore",probabilities:{ignore:0.8,draft:0.15,human:0.05}}` |
| `score` | `criteria` 为至少两个有序等级的数组 | `{type:"score",score:1.4,probabilities:{"0":0,"1":0.6,"2":0.4}}` |

`choice` 必须属于给定选项。`probabilities` 必须包含全部且仅包含给定选项，值为 0..1 的有限数值，总和与 1 的差不超过 0.02。消息插件的 `ignore`、`draft`、`human` 三项必须全部出现。校验后原样返回概率，不补造或调整数值。

`score` 为有限数值。普通模型提示词要求按从 0 开始的等级索引输出完整分布，并以索引的概率加权平均值作为 `score`。为兼容已有数值型 `score` 调用，公共校验保留其可选概率字段；如返回分布，则必须包含全部等级索引并通过相同概率校验。`confidence` 可选；若存在，必须为 0..1 的有限数值。`legend` 等附加字段保留。

System One 路径的概率与 `confidence` 由远端服务提供，插件不会重新计算。**普通模型路径中的 `probabilities`、`noul` 与 `confidence` 是模型根据提示词生成的自报估计，不是真实 token 概率，也不是经过校准的置信度。** 两种路径字段相同不代表统计含义、准确率、成本或延迟相同。

本插件只验证结构和数值范围，不保证判断正确。调用方负责业务规则、阈值验证、授权、降级策略及执行。给每个条目稳定标签，每题提出一个明确问题；精确匹配和算术应由代码完成。专用服务的指令语言限制由服务决定。

## 配置参考

配置命名空间为 `jev`。专用设置页编辑默认调用方式；多个档案和其他限制可在宿主标准插件配置编辑器中设置。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 是否允许模型调用与工具执行 |
| `provider` | `typesafe` | 内置提供商 ID 或档案 ID |
| `model` | 提供商默认值 | 模型 ID；native 模式必填 |
| `nativeProvider` | 无 | 已注册的 DSH 提供商 ID |
| `reasoningEffort` | 提供商默认值 | 仅 native 模式使用，选项来自模型目录 |
| `baseUrl` | 无 | custom 模式完整请求 URL |
| `credential` | 提供商默认值 | 凭据引用名称，不是密钥值 |
| `profiles` | `[]` | 档案数组，字段见下例 |
| `timeoutMs` | `60000` | 整次模型请求的超时，包含重试和读取响应 |
| `maxStateChars` | `40000` | 最大输入字符数 |
| `maxQuestions` | `200` | 每次最多问题数，提供商的更低限制优先 |
| `maxOutputTokens` | `2048` | native 模式输出 token 上限 |
| `maxOutputBytes` | `1048576` | native 模式流内容计数上限，包含推理和文本事件；完整 JSON 另有 1 MiB 上限 |
| `dataDir` | `<DSH_HOME>/dsh-jev` | 用量记录目录，未设置 DSH_HOME 时使用 `~/.dsh/dsh-jev` |
| `dailyCallLimit` | `500` | 每个本地自然日的调用上限，`0` 表示禁用 |
| `dailyTokenLimit` | `5000000` | 每个本地自然日的输入 token 上限，`0` 表示禁用 |

档案示例不含密钥：

```yaml
profiles:
  - id: shared-router
    name: 共享决策路由
    provider: custom
    baseUrl: https://router.example/v1/systemone
    model: jev-latest
    credential: JEV_API_KEY
  - id: ordinary-model
    name: 普通模型决策
    provider: native
    nativeProvider: your-dsh-provider-id
    model: your-model-id
```

调用时用 `provider: 'shared-router'` 或 `provider: 'ordinary-model'` 选择档案。不传时沿用已保存的默认配置。

## 用量与错误处理

每次实际调用的成功或失败均写入 `dataDir/ledger.jsonl`，设置页显示今日调用、输入 token、失败次数与费用估算。专用服务按已有费率估算；native 模型不套用 Jev 单价，实际费用由 DSH 提供商决定。混合使用时，页面金额不能代表全部提供商的账单。

达到每日限制时拒绝新调用。记录目录不可写时，用量记录仅保留在内存。超时、取消、远端错误及协议错误交给调用方处理，不自动执行业务降级。System One 路径对临时网络错误、HTTP 429 和 5xx 按已有退避策略重试，受整次调用超时约束。准备重试时，数值型 `Retry-After` 不超过 30 秒则按其等待，超过 30 秒立即报错；缺失或无效时沿用退避策略。401、403 和其他不可重试错误直接报告。

设置桥接只接受本机回环来源的 POST 请求。现有八条路由统一捕获未处理异常，返回 HTTP 500 和 `{ok:false,code:"internal-error",message}`，使用中文通用提示，不返回内部异常详情或堆栈。已有可识别错误继续保留原错误码；响应已发送时不重复写入。第三方服务、宿主和调用方提供的错误信息可能保留原语言；插件自身的界面与校验错误使用中文。

## 安装与验证

从此 fork 构建本地包：

```sh
npm install --ignore-scripts
npm test
npm pack
```

检查生成的包后，可由你选择安装到宿主：

```sh
dsh plugin --profile web add /absolute/path/dsh-jev-plugin-0.3.5.tgz
```

此命令会修改对应宿主 profile；运行中的宿主需要在方便时重启才会加载新包。此仓库的修改和测试不会自动安装、升级或重启默认宿主。不要把上游 npm 包误认为此 fork 的工作分支。

测试覆盖两条路径的成功、坏 JSON、重复字段、缺失答案、类型不匹配、完整概率、数值范围、取消、超时、卸载、目录、凭据选择、用量与客户端注册。可设置 `JEV_DSH_HOST_ROOT` 指向隔离安装的 DSH 0.2.1-rc.2，再运行 `node --test test/host-compat.test.mjs`，检查真实 DSH llm 服务与离线适配器的集成，不需要真实模型凭据。

[上游历史设计记录](docs/DECISIONS.md)与[历史测量记录](docs/MEASUREMENTS.md)保留原始英文资料。这些记录不构成本 fork 普通模型路径的性能或准确率验证。
