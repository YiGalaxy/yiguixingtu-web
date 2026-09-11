<template>
  <div class="proj">
    <header class="pj-head">
      <h1>项目</h1>
      <p v-if="failed" class="pj-sub">做过的东西，都摆在这里</p>
      <p v-else class="pj-sub">做过的东西，都摆在这里 · 共 {{ total }} 个</p>
    </header>

    <!-- 四种状态互斥（加载中 / 读不到 / 一个都没有 / 正常）。
         【为什么"加载中"和"读不到"必须是两句话】都是空列表，但用户该做的事不同：
         前者等一下就好，后者要看提示 —— 合成一句"没有数据"就成了误导。 -->
    <div v-if="pending && !list.length" class="pj-state glass">加载中…</div>
    <div v-else-if="failed" class="pj-state glass">
      项目暂时读不到，请稍后再试。
      <!-- 两个出口给的是两种"接下来做什么"：
           · 重试：多半是一次网络抖动 / 限流，再打一次就好了
           · 回首页：真的是服务端有问题时，别让用户耗在这一页上 -->
      <button class="pj-retry" type="button" @click="retry">重试</button>
      <NuxtLink class="pj-link" to="/">先去首页看看最新文章</NuxtLink>
    </div>
    <div v-else-if="!list.length" class="pj-state glass">
      这里还空着 —— 还没有放上任何项目。
    </div>

    <ul v-else class="pj-grid">
      <!-- 【顺序完全按后端给的来，前端一次都不排】后端契约是 ORDER BY sort ASC, id ASC
           （见后端 ProjectServiceImpl.query）。前端再排一次的话，
           哪天后端换了口径就会被这份排序整个盖掉，而页面上看不出异常。 -->
      <li v-for="item in list" :key="item.id" class="pj-card glass">
        <!-- 封面：有就用后端给的地址；没有就退化成"渐变底 + 首字母"。
             这个兜底是后端实体注释里写明的约定（"没有封面时前端用渐变底 + 首字母"），
             而不是我自己加的装饰 —— 缺封面的卡片如果什么都不画，
             整张卡片会看起来像加载失败。 -->
        <div class="pj-cover">
          <img v-if="item.cover" class="pc-img" :src="item.cover" :alt="textOf(item.name, '项目封面')" loading="lazy">
          <span v-else class="pc-letter">{{ initialOf(item.name) }}</span>
        </div>

        <div class="pj-body">
          <h2 class="pj-name">{{ textOf(item.name) }}</h2>
          <!-- 简介可选（后端允许为空）：没写就整段不渲染，不留一个空行 -->
          <p v-if="item.description" class="pj-desc">{{ item.description }}</p>

          <!-- 技术栈是【逗号分隔的字符串】（后端有意不做成数组，见 ProjectForm 的注释），
               前端 split 一次。空项会被过滤掉，免得"Spring Boot, , MySQL"渲染出一个空标签。 -->
          <ul v-if="techOf(item).length" class="pj-tech">
            <li v-for="t in techOf(item)" :key="t" class="pt-item">{{ t }}</li>
          </ul>

          <!-- 两种地址各自可选、但不能同时为空（后端 Service 里那条跨字段规则）。
               【为什么两个都可能是空的还要写这个分支】那条规则是"写库前校验"，
               而列表里的历史数据、或者有人直接改库，都可能出现两个都空的记录 ——
               那时卡片上至少要有一句"它为什么点不动"，而不是一张静默的卡片。 -->
          <div v-if="hasAnyLink(item)" class="pj-links">
            <a
              v-if="isExternalUrl(item.url)" class="pl-btn is-online"
              :href="item.url" target="_blank" rel="noopener">在线演示</a>
            <a
              v-if="isExternalUrl(item.repo)" class="pl-btn is-repo"
              :href="item.repo" target="_blank" rel="noopener">代码仓库</a>
          </div>
          <p v-else class="pj-nolink">这个项目还没有填在线地址或仓库地址，暂时点不开。</p>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup>
// ================================================================
// app/pages/projects.vue
//
// 作用：GET /project/list —— 项目展示页（公开接口，无需登录）。
//
// 【为什么要有这一页】
//   对个人博客来说，"我做过什么"和"我写过什么"是两件都要回答的事。
//   文章列表回答后者，项目页回答前者 —— 它们的信息形状也不同：
//   文章是按时间流动的流，项目是"一个个成品"（有封面、有技术栈、有仓库）。
//
// 【数据形状】后端 ProjectController.list() → Result<List<ProjectVO>>：
//   { id, name, description, url, repo, cover, tech, sort, status, createTime }
//   · 【不分页】后端有意一次返回全部（十几个的量级，见 ProjectController 的注释），
//     所以这里的"共 N 个"就是数组长度
//   · 【tech 是逗号分隔的字符串】不是数组（后端 ProjectForm 的注释写明了理由：
//     提交什么字符串、列表就返回什么字符串，最不容易出错），前端 split 一次
//   · 【url 与 repo 各自可空，但不能同时为空】这条规则在后端 Service 里
//     （requireAtLeastOneAddress）；前台仍然要能渲染"两个都空"的历史数据
//   · 【cover 允许 http(s) 外链，也允许 `/` 开头的站内路径】（上传接口返回的是后者）
//
// 【为什么用 useAsyncData（服务端渲染）】
//   同收藏页与归档页：这是内容，必须出现在服务端 HTML 里（爬虫读得到），
//   而且首屏不会先闪一下"加载中"。key 是常量，一次会话只取一次。
//
// 【失败必须降级】接口挂了时列表兜成空数组、页面显示一句人话 + 一个出口，
//   绝不白屏、也绝不变成整站错误页（理由见收藏页文件头，两页是同一套取舍）。
//
// 【技术栈与关键字】
//   · useAsyncData / useSeoMetaFor / NuxtLink：与其它内容页完全一致的三件套
//   · asList / isExternalUrl / textOf / splitTech：本批新增的共享纯函数
//     （app/utils/contentList.ts）—— 四个内容页用的是同一份"数据 → 可安全渲染"的规则
//   · loading="lazy"：封面图很多时不要一次全下（浏览器的原生懒加载，不需要 JS）
// ================================================================

const { request } = useApi()

// 首屏（含服务端）取一次项目列表。失败不抛异常，而是回一个"标记失败的普通结果"，
// 因为失败要能被渲染成一句话（抛出去就只剩错误页了）。
const projectsAsync = useAsyncData('f5-projects', async () => {
  const res = await request('/project/list')
  return { ok: !!res.ok, list: asList(res) }
})

// 等服务端把数据拿到再渲染：HTML 里直接带着项目卡片
await projectsAsync

const { data: projectsData, pending } = projectsAsync

const projects = computed(() => projectsData.value ?? { ok: false, list: [] })

const list = computed(() => projects.value.list)
/** 总数就是数组长度：接口不分页、没有 total 字段 */
const total = computed(() => list.value.length)
const failed = computed(() => !projects.value.ok)

/**
 * 失败状态里那个「重试」按钮。
 * 【为什么用它而不是 location.reload()】refresh() 只重跑这一个 useAsyncData 的
 *   handler（一次 GET /project/list），页面本身不重建、SEO 元信息也不动；
 *   整页 reload 会把用户从"这一页"变成"重新打开整个站"。
 * 【为什么只在失败状态给这个按钮】它是"再打一次试试"的意思 ——
 *   成功时给一个重试按钮只会让人以为数据可能不对。
 */
const retry = () => projectsAsync.refresh()

/**
 * 技术栈标签：把逗号分隔的字符串拆成一个个小标签。
 * 直接复用共享的 splitTech（它会 trim 每一项并丢掉空项）。
 */
const techOf = (item) => splitTech(item?.tech)

/**
 * "没有封面时用首字母"里的那个字母。
 * 【为什么取第一个字符而不是首单词】中文项目名取首单词没有意义（中文没有词边界），
 * 而首字符对中英文都成立："亿轨星途" → "亿"、Blog → "B"。
 * 名字缺失时返回一个中性符号，绝不让卡片上出现 undefined 或空洞。
 */
const initialOf = (name) => {
  const text = typeof name === 'string' ? name.trim() : ''
  return text ? [...text][0] : '✦'
}

/**
 * 这一条到底有没有可点的链接。
 * 【为什么要用"白名单校验过"的 isExternalUrl 而不是 `item.url || item.repo`】
 *   后者对 `javascript:` 这种值也返回真，于是模板会走进"有两个链接区"的分支，
 *   结果两个 <a> 都不渲染 —— 卡片上出现一个空的按钮区，看起来像样式坏了。
 *   两个判断必须是同一套规则。
 */
const hasAnyLink = (item) => isExternalUrl(item?.url) || isExternalUrl(item?.repo)

// ================================================================
//  项目页的 SEO 元信息
//  【canonical 固定是 /projects】页面不接受任何查询参数，不存在第二个地址。
//  【要有自己的 title / description】不写就会继承站点默认标题，
//  在搜索结果里和首页长得一模一样，两个页面互相抢同一批关键词。
// ================================================================
useSeoMetaFor(() => ({
  path: '/projects',
  title: '项目',
  description: '亿轨星途的项目列表：每个项目做了什么、用了哪些技术栈，以及在线演示与代码仓库的入口。',
  type: 'website',
}))
</script>

<style scoped>
.proj { max-width: 1080px; margin: 0 auto; padding: 40px 32px 40px; }

.pj-head { margin-bottom: 24px; }
.pj-head h1 { font-size: 28px; font-weight: 800; margin: 0 0 8px; }
.pj-sub { margin: 0; color: var(--muted); font-size: 14px; }

/* 空/错状态块：玻璃底来自全局 .glass（app.vue 的全局 style 块） */
.pj-state { border-radius: 16px; padding: 60px 24px; text-align: center; color: var(--muted); font-size: 14px; }
.pj-link { color: var(--accent); margin-left: 6px; text-decoration: none; }
.pj-link:hover { text-decoration: underline; }

/* 「重试」按钮：与链接同档的观感（不是实心按钮）—— 它是"再打一次"，
   不该比页面主体的内容更抢眼。cursor: pointer 必须显式写：
   <button> 默认是 default 光标，而我们把它当链接在用 */
.pj-retry {
  margin-left: 10px; padding: 4px 12px;
  background: rgba(242,193,78,.12); border: 1px solid rgba(242,193,78,.45);
  border-radius: 999px; color: var(--accent); font-size: 13px; cursor: pointer;
  transition: border-color .2s, color .2s;
}
.pj-retry:hover { border-color: var(--accent); color: var(--accent-strong); }

/* 卡片网格：auto-fill + minmax 让列数跟着宽度自己变（不用写一串媒体查询），
   340px 是"标题 + 一行简介 + 技术栈"能排得下的最小宽度 */
.pj-grid {
  list-style: none; margin: 0; padding: 0;
  display: grid; gap: 18px;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
}

.pj-card { border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; }

/* 封面区：固定比例（16:9）而不是固定高度 —— 不同卡片的高度因此是一致的，
   网格不会出现"高低不齐"的锯齿；没有封面时这一块是渐变底 + 首字母 */
.pj-cover {
  position: relative; aspect-ratio: 16 / 9; overflow: hidden;
  background: linear-gradient(135deg, rgba(89,214,230,.22), rgba(242,193,78,.20));
  display: flex; align-items: center; justify-content: center;
}
.pc-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pc-letter { font-size: 40px; font-weight: 800; color: rgba(255,255,255,.72); }

.pj-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
.pj-name { margin: 0; font-size: 17px; font-weight: 800; color: var(--ink); }
.pj-desc { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.7; }

/* 技术栈：一行小标签，超出宽度就换行（不隐藏、也不横向滚动） */
.pj-tech { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.pt-item {
  font-size: 12px; color: var(--accent);
  background: rgba(242,193,78,.10); border: 1px solid rgba(242,193,78,.24);
  border-radius: 999px; padding: 2px 9px;
}

/* 链接区推到底部（margin-top:auto）：同一行里所有卡片的按钮底部对齐，
   不然"简介长的卡片"按钮会被顶下去，网格看起来是歪的 */
.pj-links { margin-top: auto; display: flex; flex-wrap: wrap; gap: 8px; padding-top: 4px; }
.pl-btn {
  font-size: 13px; font-weight: 600; text-decoration: none;
  border-radius: 10px; padding: 6px 12px;
  border: 1px solid var(--line); color: var(--ink);
  transition: border-color .2s, color .2s;
}
/* 两个按钮用不同颜色区分"去哪"：在线演示是主题金（主要内容），
   代码仓库是青色（次要内容）。颜色一致的话，用户得靠读文字才知道区别 */
.pl-btn.is-online { border-color: rgba(242,193,78,.45); color: var(--accent); }
.pl-btn.is-online:hover { border-color: var(--accent); }
.pl-btn.is-repo { border-color: rgba(89,214,230,.40); color: var(--cyan); }
.pl-btn.is-repo:hover { border-color: var(--cyan); }

.pj-nolink { margin: auto 0 0; color: var(--muted); font-size: 12px; }

@media (max-width: 640px) {
  .proj { padding: 24px 16px; }
  /* 窄屏下一列排满：340px 的固定下限在 320px 屏上会横向溢出 */
  .pj-grid { grid-template-columns: 1fr; }
}
</style>
