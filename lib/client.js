/**
 * dsh-jev-plugin — browser half.
 *
 * Registers a JEV page in Settings (`settings.section`) that lets
 * each user pick the provider, point at a custom endpoint, and store their own
 * API key in the DSH credentials service.
 *
 * Written as plain React.createElement (no JSX) in the __ModuleLoader__ bundle
 * format this deployment loads plugin clients with.
 *
 * ON THE ID BELOW. It must equal the package name exactly. The client-modules
 * boot config is keyed by package name —
 * `{"id":"dsh-jev-plugin","url":"/plugins/??dsh-jev-plugin/client.js","inject":[…]}` —
 * and the loader looks this module up by that key. It registered as `dsh-jev`
 * while the package was `dsh-jev-plugin`, so the lookup missed and the client
 * half died with `failed to import loader entry`.
 *
 * It is a literal rather than a shared constant on purpose: DSH concatenates
 * every plugin's client half into ONE script
 * (`/plugins/??a/client.js,b/client.js,…`), so a top-level declaration here would
 * share a scope with ~40 other plugins and a name collision would take the whole
 * bundle down, not just this card. `test/client-bundle.test.mjs` asserts the id
 * matches package.json instead, so a future rename fails the suite rather than
 * the browser.
 */
window.__ModuleLoader__.load({
  id: 'dsh-jev-plugin',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement

    const BRIDGE = '/api/dsh-jev-settings'
    const NS = 'jev'
    // Scoped inside the factory, so it cannot collide with the other plugins
    // concatenated into the same script. Must stay in step with the loader id
    // above; `test/client-bundle.test.mjs` checks both against package.json.
    const PACKAGE = 'dsh-jev-plugin'

    const css = `
.dshjev-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:8px;min-width:0;list-style:none;overflow:hidden;margin-bottom:8px}
.dshjev-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dshjev-header{width:100%;color:inherit;cursor:pointer;text-align:left;font:inherit;background:0 0;border:0;align-items:center;gap:8px;padding:10px 14px;display:flex}
.dshjev-header:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshjev-headText{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex;overflow:hidden}
.dshjev-name{color:var(--dsw-alias-label-primary);white-space:nowrap;text-overflow:ellipsis;font-weight:600;overflow:hidden}
.dshjev-description{color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;font-size:12px;overflow:hidden}
.dshjev-badge{flex:none;font-size:11px;padding:2px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}
.dshjev-badgeOk{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.dshjev-badgeWarn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.dshjev-chevron{color:var(--dsw-alias-label-tertiary);flex:none;font-size:13px;transition:transform .12s}
.dshjev-chevronOpen{transform:rotate(180deg)}
.dshjev-body{flex-direction:column;gap:14px;padding:0 14px 14px;display:flex}
.dshjev-field{flex-direction:column;gap:4px;min-width:0;display:flex}
.dshjev-label{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500}
.dshjev-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.dshjev-input,.dshjev-select{border:1px solid var(--dsw-alias-border-l2);font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border-radius:6px;padding:6px 8px;font-size:13px;width:100%}
.dshjev-compact{width:24rem;max-width:100%;box-sizing:border-box}
.dshjev-select{color-scheme:light dark}
.dshjev-select option{background-color:#fff;color:#1f2328}
@media (prefers-color-scheme:dark){.dshjev-select{color-scheme:dark}.dshjev-select option{background-color:#1e1f24;color:#e8e8ea}}
.dshjev-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshjev-btn{cursor:pointer;font:inherit;font-size:13px;border-radius:6px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dshjev-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dshjev-btn:disabled{opacity:.5;cursor:default}
.dshjev-primary{border-color:var(--dsw-alias-label-dimmed);font-weight:600}
.dshjev-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:1.6;white-space:pre-wrap}
.dshjev-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.6;white-space:pre-wrap}
.dshjev-usage{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshjev-usage .dshjev-btn{font-size:11px;padding:2px 8px}
`

    function adoptStyles() {
      const ID = 'dsh-jev-styles'
      if (document.getElementById(ID) !== null) return
      const style = document.createElement('style')
      style.id = ID
      style.textContent = css
      document.head.appendChild(style)
    }

    async function post(route, body) {
      const response = await fetch(`${BRIDGE}/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      return response.json()
    }

    function Field(props) {
      return h(
        'label',
        { className: 'dshjev-field' },
        h('span', { className: 'dshjev-label' }, props.label),
        props.children,
        props.hint ? h('span', { className: 'dshjev-hint' }, props.hint) : null,
      )
    }

    function JevCard({ expanded = false } = {}) {
      const [open, setOpen] = React.useState(expanded)
      const [view, setView] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [key, setKey] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState(null)
      const [test, setTest] = React.useState(null)
      const [keyStatus, setKeyStatus] = React.useState(null)
      const [catalog, setCatalog] = React.useState({providers:[], models:[], provider:'', loading:false, error:null})

      const load = React.useCallback(async () => {
        try {
          const result = await post('describe')
          if (result?.ok) {
            setView(result.value)
            setDraft({
              enabled: result.value.value.enabled !== false,
              provider: result.value.value.provider ?? 'typesafe',
              model: result.value.value.model ?? '',
              baseUrl: result.value.value.baseUrl ?? '',
              nativeProvider: result.value.value.nativeProvider ?? '',
              reasoningEffort: result.value.value.reasoningEffort ?? '',
            })
          } else {
            setNote({ bad: true, text: result?.message ?? '无法读取设置' })
          }
        } catch (error) {
          setNote({ bad: true, text: String(error?.message ?? error) })
        }
      }, [])

      const resetUsage = async () => {
        setBusy(true)
        try {
          const result = await post('usage', { reset: true })
          // Only the usage figure changes: reloading the whole view would throw
          // away an edit the user has not saved yet.
          if (result?.ok) setView((v) => ({ ...v, usage: result.value }))
          else setNote({ bad: true, text: result?.message ?? '无法重置用量记录' })
        } catch (error) {
          setNote({ bad: true, text: String(error?.message ?? error) })
        } finally {
          setBusy(false)
        }
      }

      React.useEffect(() => {
        if (open && view === null) void load()
      }, [open, view, load])

      const providers = view?.providers ?? []
      const provider = providers.find((p) => p.id === draft?.provider) ?? providers[0]
      const nativeMode = draft?.provider === 'native'
      const models = catalog.provider === draft?.nativeProvider ? catalog.models : []
      const selectedModel = models.find(m => m.id === draft?.model)
      const efforts = selectedModel?.reasoningEfforts ?? []
      React.useEffect(() => {
        if (!open || !nativeMode || draft === null) return
        let disposed = false
        setCatalog(c => ({...c, loading:true, error:null}))
        post('catalog', {provider:draft.nativeProvider || undefined}).then(result => {
          if (disposed) return
          if (result?.ok) setCatalog({...result.value, loading:false, error:null})
          else setCatalog(c => ({...c, loading:false, error:result?.message ?? '无法加载 DSH 模型。'}))
        }).catch(() => {
          if (!disposed) setCatalog(c => ({...c, loading:false, error:'无法加载 DSH 模型，请重新加载后重试。'}))
        })
        return () => {disposed = true}
      }, [open, nativeMode, draft?.nativeProvider, view])

      const select = (value, choices, onChange, defaultLabel, disabled = false) => h('select', {
        className:'dshjev-select dshjev-compact', value:value ?? '', disabled:busy || catalog.loading || disabled,
        onChange:event => onChange(event.target.value),
      },
        h('option', {value:'', disabled:defaultLabel.startsWith('选择')}, defaultLabel),
        value && !choices.some(c => c.id === value) ? h('option', {value, disabled:true}, `${value} （当前已配置，但不可用）`) : null,
        choices.map(c => h('option', {key:c.id, value:c.id}, c.name || c.id)),
      )
      const selectedKey = keyStatus?.provider === draft?.provider ? keyStatus : null
      React.useEffect(() => {
        setKeyStatus(null)
        if (!open || !draft || !view || nativeMode || provider?.nativeProvider) return
        let disposed = false
        post('key-describe',{provider:draft.provider, expectedRevision:view.revision}).then(result => {
          if (!disposed && result?.ok) setKeyStatus(result.value)
        }).catch(() => {})
        return () => {disposed = true}
      }, [open, draft?.provider, view?.revision])
      const dirty =
        draft !== null &&
        view !== null &&
        (draft.enabled !== (view.value.enabled !== false) ||
          draft.provider !== (view.value.provider ?? 'typesafe') ||
          draft.model !== (view.value.model ?? '') ||
          draft.baseUrl !== (view.value.baseUrl ?? '') ||
          draft.nativeProvider !== (view.value.nativeProvider ?? '') ||
          draft.reasoningEffort !== (view.value.reasoningEffort ?? ''))

      const run = async (fn) => {
        setBusy(true)
        setNote(null)
        try {
          await fn()
        } catch (error) {
          setNote({ bad: true, text: String(error?.message ?? error) })
        } finally {
          setBusy(false)
        }
      }

      const save = () =>
        run(async () => {
          const result = await post('mutate', {
            expectedRevision: view?.revision,
            ops: [
              { op: 'set', path: ['enabled'], value: draft.enabled },
              { op: 'set', path: ['provider'], value: draft.provider },
              { op: 'set', path: ['model'], value: draft.model },
              { op: 'set', path: ['baseUrl'], value: draft.baseUrl },
              { op: 'set', path: ['nativeProvider'], value: draft.nativeProvider },
              { op: 'set', path: ['reasoningEffort'], value: draft.reasoningEffort },
            ],
          })
          if (!result?.ok) {
            setNote({ bad: true, text: result?.message ?? '设置未通过校验' })
            return
          }
          setView(result.value)
          setNote({ text: '已保存。' })
        })

      const saveKey = () =>
        run(async () => {
          const result = await post('key-set', {value:key, provider:draft.provider, expectedRevision:view.revision})
          if (!result?.ok) {
            setNote({ bad: true, text: result?.message ?? '密钥保存失败' })
            return
          }
          setKey('')
          setView(result.value)
          setKeyStatus(result.key)
          setNote({ text: `已为 ${result.key.credential} 保存密钥。保存提供商设置后生效。` })
        })

      const clearKey = () =>
        run(async () => {
          const result = await post('key-unset', {provider:draft.provider, expectedRevision:view.revision})
          if (!result?.ok) {
            setNote({ bad: true, text: result?.message ?? '无法移除密钥' })
            return
          }
          setView(result.value)
          setKeyStatus(result.key)
          setNote({ text: '密钥已移除。' })
        })

      const runTest = () =>
        run(async () => {
          setTest(null)
          const result = await post('test')
          setTest(result)
        })

      const status = () => {
        if (view === null) return h('span', { className: 'dshjev-badge' }, '…')
        if (dirty) return h('span', {className:'dshjev-badge dshjev-badgeWarn'}, '设置尚未保存')
        if (view.nativeProvider) return h('span', {className:'dshjev-badge dshjev-badgeOk'}, 'DSH 模型')
        if (view.keyConfigured) return h('span', { className: 'dshjev-badge dshjev-badgeOk' }, '已配置密钥')
        if (view.envFallback) return h('span', { className: 'dshjev-badge dshjev-badgeOk' }, '使用环境变量')
        return h('span', { className: 'dshjev-badge dshjev-badgeWarn' }, '未配置密钥')
      }

      return h(
        'li',
        { className: open ? 'dshjev-card dshjev-cardOpen' : 'dshjev-card' },
        h(
          'button',
          {
            className: 'dshjev-header',
            type: 'button',
            onClick: () => setOpen(!open),
            'aria-expanded': open,
          },
          h(
            'span',
            { className: 'dshjev-headText' },
            h('span', { className: 'dshjev-name' }, 'Jev'),
            h(
              'span',
              { className: 'dshjev-description' },
              '批量结构化决策（noul / choice / score），返回选项概率。',
            ),
          ),
          status(),
          h('span', { className: open ? 'dshjev-chevron dshjev-chevronOpen' : 'dshjev-chevron' }, '▾'),
        ),
        open
          ? h(
              'div',
              { className: 'dshjev-body' },
              h(
                Field,
                { label: '提供商', hint: '选择请求端点与模型。各提供商分别使用自己的 API 密钥。' },
                h(
                  'select',
                  {
                    className: 'dshjev-select',
                    value: draft?.provider ?? 'typesafe',
                    disabled: busy || draft === null,
                    onChange: (event) => {setDraft({...draft, provider:event.target.value, model:'', reasoningEffort:''});setKey('');setNote(null);setTest(null)},
                  },
                  providers.map((p) => h('option', { key: p.id, value: p.id }, p.label)),
                ),
              ),
              provider && provider.url
                ? h(
                    'span',
                    { className: 'dshjev-hint' },
                    `端点：${provider.url} · `
                    + (provider.modelHint ?? `默认模型 ${provider.model}`),
                  )
                : null,
              provider && provider.note
                ? h('span', { className: 'dshjev-hint' }, provider.note)
                : null,
              nativeMode ? h(React.Fragment, null,
                h(Field,{label:'DSH 提供商',hint:'选择已注册的 DSH 提供商。密钥在“模型”设置中管理。'},
                  select(draft.nativeProvider,catalog.providers,value=>setDraft({...draft,nativeProvider:value,model:'',reasoningEffort:''}),'选择提供商')),
                h(Field,{label:'推理强度',hint:'选项由当前模型决定。使用默认值时沿用提供商设置。'},
                  select(draft.reasoningEffort,efforts,value=>setDraft({...draft,reasoningEffort:value}),'提供商默认值',!selectedModel || efforts.length === 0)),
                catalog.error ? h('span',{className:'dshjev-err',role:'alert'},catalog.error) : null,
              ) : null,
              draft?.provider === 'custom'
                ? h(
                    Field,
                    {
                      label: '完整请求 URL',
                      hint: '填写实现 TypeSafe 协议的完整 POST /v1/systemone 地址。按原地址发送，不追加路径。',
                    },
                    h('input', {
                      className: 'dshjev-input',
                      value: draft.baseUrl,
                      disabled: busy,
                      placeholder: 'https://example.com/v1/systemone',
                      onChange: (event) => setDraft({ ...draft, baseUrl: event.target.value }),
                    }),
                  )
                : null,
              h(
                Field,
                {
                  label: nativeMode ? '模型' : '模型覆盖值',
                  hint: nativeMode ? '从当前 DSH 提供商的模型目录中选择。' : '留空时使用上方显示的默认模型。',
                },
                nativeMode ? select(draft.model,models,value=>setDraft({...draft,model:value,reasoningEffort:''}),'选择模型',!draft.nativeProvider) : h('input', {
                  className: 'dshjev-input',
                  value: draft?.model ?? '',
                  disabled: busy || draft === null,
                  placeholder: provider?.modelHint ? 'english | multilingual | typed-decisions' : (provider?.model ?? ''),
                  onChange: (event) => setDraft({ ...draft, model: event.target.value }),
                }),
              ),
              (provider?.id === 'native' || provider?.nativeProvider) ? h('p', {className:'dshjev-hint'}, '普通模型的密钥和计费由 DSH 模型设置及所选提供商管理。概率为模型自报估计，不是真实 token 概率或校准置信度。') : h(
                Field,
                {
                  label: `${provider?.label ?? '所选提供商'}的 API 密钥`,
                  hint: provider?.keyHint
                    ? `${provider.keyHint}。保存在 DSH 凭据存储中，不写入 settings.yaml。`
                    : '保存在 DSH 凭据存储中。',
                },
                h(
                  'span',
                  { className: 'dshjev-row' },
                  h('input', {
                    className: 'dshjev-input',
                    style: { flex: '1 1 220px' },
                    type: 'password',
                    value: key,
                    disabled: busy,
                    autoComplete: 'off',
                    placeholder: selectedKey?.configured ? '••••（已配置，输入新密钥可替换）' : '粘贴密钥',
                    onChange: (event) => setKey(event.target.value),
                  }),
                  h(
                    'button',
                    {
                      className: 'dshjev-btn',
                      type: 'button',
                      disabled: busy || key.trim().length === 0,
                      onClick: saveKey,
                    },
                    '保存密钥',
                  ),
                  h(
                    'button',
                    {
                      className: 'dshjev-btn',
                      type: 'button',
                      disabled: busy || !selectedKey?.configured,
                      onClick: clearKey,
                    },
                    '移除',
                  ),
                ),
              ),
              h(
                'label',
                { className: 'dshjev-row' },
                h('input', {
                  type: 'checkbox',
                  checked: draft?.enabled !== false,
                  disabled: busy || draft === null,
                  onChange: (event) => setDraft({ ...draft, enabled: event.target.checked }),
                }),
                h('span', { className: 'dshjev-label' }, '启用 Jev 模型调用与工具'),
              ),
              view?.endpointError
                ? h('span', { className: 'dshjev-err' }, view.endpointError)
                : null,
              note
                ? h('span', { className: note.bad ? 'dshjev-err' : 'dshjev-ok' }, note.text)
                : null,
              test
                ? h(
                    'span',
                    { className: test.ok ? 'dshjev-ok' : 'dshjev-err' },
                    test.ok
                      ? `成功 · ${test.value.provider} · ${test.value.model} · ${test.value.latencyMs} ms · ${test.value.inputTokens ?? "未知"} 个输入 token\n${JSON.stringify(test.value.answers)}`
                      : `失败：${test.message}`,
                  )
                : null,
              view?.usage
                ? h(
                    'span',
                    { className: 'dshjev-usage' },
                    `今日 · ${view.usage.calls} 次决策`
                      + ` · ${Number(view.usage.inputTokens).toLocaleString()} 个输入 token`
                      + ` · $${Number(view.usage.costUsd).toFixed(4)}`
                      + (view.usage.failures > 0 ? ` · ${view.usage.failures} 次失败` : ''),
                    h(
                      'button',
                      { className: 'dshjev-btn', type: 'button', disabled: busy, onClick: resetUsage },
                      '重置',
                    ),
                  )
                : null,
              h(
                'span',
                { className: 'dshjev-row' },
                h(
                  'button',
                  {
                    className: 'dshjev-btn dshjev-primary',
                    type: 'button',
                    disabled: busy || !dirty || (nativeMode && (!draft.nativeProvider || !draft.model)),
                    onClick: save,
                  },
                  busy ? '处理中…' : '保存设置',
                ),
                h(
                  'button',
                  {
                    className: 'dshjev-btn',
                    type: 'button',
                    disabled: busy || !dirty || view === null,
                    onClick: () =>
                      setDraft({
                        enabled: view.value.enabled !== false,
                        provider: view.value.provider ?? 'typesafe',
                        model: view.value.model ?? '',
                        baseUrl: view.value.baseUrl ?? '',
                        nativeProvider: view.value.nativeProvider ?? '',
                        reasoningEffort: view.value.reasoningEffort ?? '',
                      }),
                  },
                  '放弃修改',
                ),
                h(
                  'button',
                  { className: 'dshjev-btn', type: 'button', disabled: busy || dirty, onClick: runTest },
                  '测试连接',
                ),
                h(
                  'button',
                  { className: 'dshjev-btn', type: 'button', disabled: busy, onClick: () => void load() },
                  '重新加载',
                ),
              ),
            )
          : null,
      )
    }

    const inject = ['slots']

    function apply(ctx) {
      adoptStyles()
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: NS,
            label: 'JEV 决策',
            order: 31,
            inject: () => ({}),
          },
          () => h(JevCard, { expanded: true }),
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
