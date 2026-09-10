<template>
  <div class="admin">
    <!-- ==================== 左侧菜单 ==================== -->
    <aside class="side glass">
      <div class="side-brand"><span class="mk">✦</span> 亿轨星途 · 后台</div>
      <nav class="side-nav">
        <a
v-for="m in menus" :key="m.key"
           :class="{ active: cur === m.key }"
           @click="cur = m.key">{{ m.label }}</a>
      </nav>
    </aside>

    <div class="main">

      <!-- ==================== ① 概览 ==================== -->
      <template v-if="cur === 'overview'">
        <header class="top">
          <h1>概览</h1>
          <p>全站汇总数据（文章数与浏览量只统计已发布文章）</p>
        </header>
        <!-- 四个数字的来源是【独立请求】，和下面各管理页当前的筛选条件无关：
             文章 / 浏览 / 分类走公开接口 GET /article/stats（后端一条聚合 SQL 算好），
             用户在 /user/page 里筛选了什么都不会影响这里。
             接口失败时显示「—」，而不是假装是 0。 -->
        <div class="stats">
          <div class="stat glass"><span>文章（已发布）</span><b>{{ statText(siteStats.articleCount, statsFailed) }}</b></div>
          <div class="stat glass"><span>浏览量</span><b>{{ statText(siteStats.viewCount, statsFailed) }}</b></div>
          <div class="stat glass"><span>分类</span><b>{{ statText(siteStats.categoryCount, statsFailed) }}</b></div>
          <div class="stat glass"><span>用户</span><b>{{ statText(userCount, userCountFailed) }}</b></div>
        </div>
        <div class="panel glass">
          <div class="panel-head">最近文章</div>
          <div v-if="articles.length === 0" class="empty">还没有文章，去「文章管理」写第一篇吧</div>
          <ul v-else class="recent">
            <li v-for="a in articles.slice(0, 5)" :key="a.id">
              <span class="r-title">{{ a.title }}</span>
              <span class="r-meta">
                <el-tag :type="a.status === 1 ? 'success' : 'info'" size="small" effect="plain">
                  {{ a.status === 1 ? '已发布' : '草稿' }}
                </el-tag>
                {{ fmtTime(a.createTime) }}
              </span>
            </li>
          </ul>
        </div>
      </template>

      <!-- ==================== ② 文章管理 ==================== -->
      <template v-else-if="cur === 'articles'">
        <header class="top">
          <h1>文章管理</h1>
          <p>共 {{ artTotal }} 篇文章</p>
        </header>

        <!-- 搜索 / 筛选栏 -->
        <div class="toolbar glass">
          <el-input
v-model="artQuery.keyword" placeholder="搜索标题 / 摘要"
                    clearable class="tb-item" @keyup.enter="searchArticles" />
          <el-select v-model="artQuery.categoryId" placeholder="全部分类" clearable class="tb-item">
            <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
          <el-select v-model="artQuery.status" placeholder="全部状态" clearable class="tb-item">
            <el-option label="已发布" :value="1" />
            <el-option label="草稿" :value="0" />
          </el-select>
          <el-button type="primary" @click="searchArticles">查询</el-button>
          <el-button @click="resetArticles">重置</el-button>
          <el-button type="success" @click="openCreate">+ 新建文章</el-button>
        </div>

        <!-- 表格 -->
        <div class="panel glass">
          <!-- 列宽合计 70+210+84+76+164+186 = 790px。
               这个数字必须 ≤ 表格可用宽度（窄窗口下约 810px），
               否则右侧 fixed 的「操作」列会压住「更新时间」—— 用户表那次的坑。 -->
          <el-table
ref="artTableRef" v-loading="artLoading" :data="articles"
                    empty-text="还没有文章，点右上角「新建文章」开始写吧"
                    :default-sort="{ prop: 'createTime', order: 'descending' }"
                    @sort-change="onArtSortChange">
            <el-table-column prop="id" label="ID" width="70" sortable="custom" />

            <el-table-column prop="title" label="标题" min-width="210" sortable="custom">
              <template #default="{ row }">
                <!-- 标题 + 标记做成一行，省掉一整个「分类」列的位置 -->
                <span class="art-title">{{ row.title }}</span>
                <el-tag v-if="row.isTop === 1" size="small" type="warning" effect="plain" class="art-tag">置顶</el-tag>
                <el-tag v-if="row.categoryName" size="small" type="info" effect="plain" class="art-tag">
                  {{ row.categoryName }}
                </el-tag>
              </template>
            </el-table-column>

            <el-table-column prop="status" label="状态" width="84" sortable="custom">
              <template #default="{ row }">
                <el-tag :type="row.status === 1 ? 'success' : 'info'" effect="plain">
                  {{ row.status === 1 ? '已发布' : '草稿' }}
                </el-tag>
              </template>
            </el-table-column>

            <el-table-column prop="viewCount" label="浏览" width="76" sortable="custom" />

            <el-table-column prop="updateTime" label="更新时间" min-width="164" sortable="custom">
              <template #default="{ row }">{{ fmtTime(row.updateTime) }}</template>
            </el-table-column>

            <el-table-column label="操作" width="186" fixed="right">
              <template #default="{ row }">
                <el-button size="small" @click="openArticleEdit(row)">编辑</el-button>
                <el-button
size="small"
                           :type="row.status === 1 ? 'warning' : 'success'"
                           @click="toggleArticleStatus(row)">
                  {{ row.status === 1 ? '下架' : '发布' }}
                </el-button>
                <el-button size="small" type="danger" @click="removeArticle(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="pager">
            <el-pagination
background
              layout="total, sizes, prev, pager, next"
              :total="artTotal"
              :current-page="artQuery.page"
              :page-size="artQuery.size"
              :page-sizes="[5, 10, 20, 50]"
              @current-change="onArtPageChange"
              @size-change="onArtSizeChange" />
          </div>
        </div>
      </template>

      <!-- ==================== ③ 用户管理 ==================== -->
      <template v-else-if="cur === 'users'">
        <header class="top">
          <h1>用户管理</h1>
          <p>共 {{ total }} 位注册用户</p>
        </header>

        <!-- 搜索 / 筛选栏 -->
        <div class="toolbar glass">
          <el-input
v-model="query.keyword" placeholder="搜索用户名 / 昵称"
                    clearable class="tb-item" @keyup.enter="search" />
          <el-select v-model="query.role" placeholder="全部角色" clearable class="tb-item">
            <el-option label="管理员" value="ADMIN" />
            <el-option label="游客" value="GUEST" />
          </el-select>
          <el-select v-model="query.status" placeholder="全部状态" clearable class="tb-item">
            <el-option label="正常" :value="1" />
            <el-option label="禁用" :value="0" />
          </el-select>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
        </div>

        <!-- 表格 -->
        <div class="panel glass">
          <!-- 排序说明：sortable="custom" 表示【由后端排序】而不是前端本地排。
               因为我们是分页查询，只排当前页是错的 —— 必须让后端排完再分页。
               点表头会触发 @sort-change，我们把字段和方向发给后端。 -->
          <el-table
ref="tableRef" v-loading="loading" :data="users" empty-text="暂无用户数据"
                    :default-sort="{ prop: 'createTime', order: 'descending' }"
                    @sort-change="onSortChange">
            <!-- 列宽合计必须 ≤ 表格可用宽度，否则 el-table 会横向溢出，
                 而右侧 fixed 的「操作」列会被钉在容器右边缘、压住「创建时间」。
                 当前合计：76+104+94+86+86+164+200 = 810px
                 注：ID 列不能更窄了 —— 表头「ID」+ 排序箭头实测需要 39px，
                 64px 的列只剩 1px 余量，换个缩放比例就可能被切掉，所以留到 76px。 -->
            <el-table-column prop="id" label="ID" width="76" sortable="custom" />
            <el-table-column prop="username" label="用户名" min-width="104" sortable="custom" />
            <el-table-column prop="nickname" label="昵称" min-width="94" sortable="custom" />

            <el-table-column prop="role" label="角色" width="86" sortable="custom">
              <template #default="{ row }">
                <el-tag :type="row.role === 'ADMIN' ? 'warning' : 'info'" effect="dark">
                  {{ row.role === 'ADMIN' ? '管理员' : '游客' }}
                </el-tag>
              </template>
            </el-table-column>

            <el-table-column prop="status" label="状态" width="86" sortable="custom">
              <template #default="{ row }">
                <el-tag :type="row.status === 1 ? 'success' : 'danger'" effect="plain">
                  {{ row.status === 1 ? '正常' : '禁用' }}
                </el-tag>
              </template>
            </el-table-column>

            <el-table-column prop="createTime" label="创建时间" min-width="164" sortable="custom">
              <template #default="{ row }">{{ fmtTime(row.createTime) }}</template>
            </el-table-column>

            <el-table-column label="操作" width="200" fixed="right">
              <template #default="{ row }">
                <el-button size="small" :disabled="row.id === myId" @click="openEdit(row)">编辑</el-button>
                <el-button
size="small"
                           :type="row.status === 1 ? 'warning' : 'success'"
                           :disabled="row.id === myId"
                           @click="toggleStatus(row)">
                  {{ row.status === 1 ? '禁用' : '启用' }}
                </el-button>
                <el-button
size="small" type="danger"
                           :disabled="row.id === myId"
                           @click="removeUser(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>

          <!-- 分页 -->
          <div class="pager">
            <el-pagination
background
              layout="total, sizes, prev, pager, next"
              :total="total"
              :current-page="query.page"
              :page-size="query.size"
              :page-sizes="[5, 10, 20, 50]"
              @current-change="onPageChange"
              @size-change="onSizeChange" />
          </div>
        </div>
      </template>

      <!-- ==================== ④ 标签管理 ==================== -->
      <template v-else-if="cur === 'tags'">
        <header class="top">
          <h1>标签管理</h1>
          <p>共 {{ tags.length }} 个标签（「已发布文章数」只统计已发布的文章，草稿不计入）</p>
        </header>

        <div class="toolbar glass">
          <el-button type="success" @click="openTagCreate">+ 新建标签</el-button>
          <el-button @click="fetchTags">刷新</el-button>
          <!-- 这句提示是必要的：标签全靠这里建，而文章弹窗的下拉框只能"选"不能"加" -->
          <span class="tb-hint">标签在文章弹窗里是多选框的选项，这里建完立刻就能选到。</span>
        </div>

        <div class="panel glass">
          <el-table
v-loading="tagLoading" :data="tags"
                    empty-text="还没有标签，点左上角「新建标签」建一个吧">
            <el-table-column prop="name" label="标签名" min-width="200">
              <template #default="{ row }"><span class="art-title">{{ row.name }}</span></template>
            </el-table-column>
            <el-table-column prop="sort" label="排序" width="90" />
            <el-table-column prop="articleCount" label="已发布文章数" width="130">
              <template #default="{ row }">
                <!-- 【0 也要显示成 0，不能显示成「—」】这里的 0 是后端算出来的确定答案
                     （一条 GROUP BY 的结果，没有文章就是 0，不是"读不到"）；
                     这类数字显示成占位符反而会让人以为接口坏了。 -->
                {{ row.articleCount ?? 0 }}
              </template>
            </el-table-column>
            <!-- 固定列宽度只放一个「编辑」一个「删除」，170px 够；
                 列宽合计 90+130+170=390，加上名字那列的 min-width 也不会超过表格可用宽度，
                 右侧 fixed 的「操作」列不会压到别的列（用户表那次踩过的坑） -->
            <el-table-column label="操作" width="170" fixed="right">
              <template #default="{ row }">
                <el-button size="small" @click="openTagEdit(row)">编辑</el-button>
                <el-button size="small" type="danger" @click="removeTag(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </template>

      <!-- ==================== ⑤ 分类（只读） ==================== -->
      <!-- 【为什么分类只做只读，不做增删改】
           后端其实【已经】把分类的写接口做好了（AdminCategoryController：
           POST/PUT/DELETE /admin/category），但这一批任务的约定是"分类的增删改不在本次范围内"，
           所以这里刻意只接一个 GET /admin/category/list。
           【为什么不摆一个"该模块开发中"的占位】因为分类数据是真实存在、真实可读的，
           摆占位等于把"已经有了的东西"说成没有；只读列表至少是诚实的：
           管理员能看见现在有哪些分类、各是什么描述，也知道改不了。
           下面那行说明写清楚"接口有、前台没接"，免得有人以为是后端不支持。 -->
      <template v-else-if="cur === 'categories'">
        <header class="top">
          <h1>分类</h1>
          <p>共 {{ categories.length }} 个分类</p>
        </header>

        <div class="panel glass">
          <div class="panel-note">
            当前为<strong>只读</strong>：分类的增删改后端已有接口，前台的编辑界面还没接。
            需要调整分类请先在数据库或后端接口上操作。
          </div>
          <el-table :data="categories" empty-text="还没有分类">
            <el-table-column prop="id" label="ID" width="80" />
            <el-table-column prop="name" label="分类名" min-width="180" />
            <el-table-column prop="sort" label="排序" width="90" />
            <el-table-column prop="description" label="描述" min-width="260" />
          </el-table>
        </div>
      </template>

      <!-- ==================== ⑥ 其他模块占位 ==================== -->
      <template v-else>
        <header class="top"><h1>{{ curLabel }}</h1><p>该模块开发中。</p></header>
        <div class="panel glass"><div class="empty">该模块开发中 · 敬请期待</div></div>
      </template>

    </div>

    <!-- ==================== 编辑用户弹窗 ==================== -->
    <el-dialog
v-model="editVisible" class="user-edit-modal" title="编辑用户"
               width="420px" :close-on-click-modal="false">
      <div class="ed-row">
        <span class="ed-label">用户名</span>
        <span class="ed-static">{{ editForm.username }}</span>
      </div>

      <div class="ed-row">
        <span class="ed-label">角色权限</span>
        <el-select v-model="editForm.role" style="width:100%">
          <el-option label="管理员（可进后台、可管理）" value="ADMIN" />
          <el-option label="游客（只能浏览）" value="GUEST" />
        </el-select>
      </div>

      <div class="ed-row">
        <span class="ed-label">新密码</span>
        <el-input
v-model="editForm.password" type="password" show-password
                  placeholder="留空则不修改密码（6-20 位）" />
      </div>

      <p class="ed-tip">提示：角色和密码只填需要改的那一项，留空 / 未变动则不会提交。</p>

      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- ==================== 新建 / 编辑文章弹窗 ==================== -->
    <!-- destroy-on-close：关掉时销毁内容。编辑器是个重组件，
         不销毁的话每次打开都会累积一个 CodeMirror 实例，写久了会卡。 -->
    <el-dialog
v-model="artEditVisible" class="art-edit-modal"
               :title="artForm.id ? '编辑文章' : '新建文章'"
               width="min(1080px, 92vw)" top="4vh"
               :close-on-click-modal="false" destroy-on-close>

      <div class="af-row">
        <span class="ed-label">标题</span>
        <el-input
v-model="artForm.title" placeholder="给你的文章起个标题"
                  maxlength="200" show-word-limit />
      </div>

      <div class="af-row">
        <span class="ed-label">分类</span>
        <el-select
v-model="artForm.categoryId" placeholder="选择分类（也可以不选）"
                   clearable style="width:100%">
          <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
      </div>

      <!-- 标签：多选。
           · 选项来自 GET /admin/tag/list（后台那份【不走缓存】，刚建的标签立刻能选到）
           · 打开弹窗时会重新拉一次：标签管理那边刚建完标签就切过来编辑文章，
             下拉框里必须已经有它，否则用户只能"刷新整个页面"才能选到
           · 提交时【永远带上 tagIds】（一个都没选就是空数组），语义见 saveArticle 里的说明 -->
      <div class="af-row">
        <span class="ed-label">标签</span>
        <el-select
v-model="artForm.tagIds" multiple collapse-tags collapse-tags-tooltip
                   :max-collapse-tags="4"
                   :placeholder="tags.length ? '选择标签（可以不选）' : '还没有标签，去「标签管理」新建'"
                   style="width:100%">
          <el-option v-for="t in tags" :key="t.id" :label="t.name" :value="t.id" />
        </el-select>
        <span class="af-hint">一个都不选就是「没有标签」</span>
      </div>

      <div class="af-row">
        <span class="ed-label">封面</span>
        <div class="cover-field">
          <img v-if="artForm.cover" :src="artForm.cover" class="cover-preview" alt="封面预览" >
          <div class="cover-btns">
            <!--
              用 el-upload 但关掉它自带的请求（auto-upload=false + on-change）：
              真正的上传逻辑在 useUpload 里，这样上传规则可以单独写测试，
              也不会因为 Element Plus 的版本差异而影响业务逻辑。
              另外不要用 el-upload 的 action 属性直接传 URL ——
              那样它不会带上 Authorization 头，后端会返回 401。
            -->
            <el-upload
              :show-file-list="false"
              :auto-upload="false"
              accept="image/jpeg,image/png,image/gif,image/webp"
              :on-change="onCoverChosen"
            >
              <el-button :loading="coverUploading">
                {{ artForm.cover ? '更换封面' : '上传封面' }}
              </el-button>
            </el-upload>
            <el-button v-if="artForm.cover" plain @click="artForm.cover = ''">移除</el-button>
          </div>
          <span class="af-hint">
            支持 {{ ALLOWED_EXTENSIONS.join(' / ') }}，单张不超过 {{ MAX_SIZE_TEXT }}
          </span>
        </div>
      </div>

      <div class="af-row">
        <span class="ed-label">摘要</span>
        <el-input
v-model="artForm.summary" type="textarea" :rows="2"
                  placeholder="留空则自动从正文截取前 120 字"
                  maxlength="500" show-word-limit />
      </div>

      <div class="af-row">
        <span class="ed-label">选项</span>
        <div class="af-opts">
          <el-switch
v-model="artForm.isTop" :active-value="1" :inactive-value="0"
                     active-text="置顶" />
          <el-switch
v-model="artForm.status" :active-value="1" :inactive-value="0"
                     active-text="已发布" inactive-text="草稿" />
          <!-- 这条提示很重要：草稿是安全的默认值，不点这个开关就不会发出去 -->
          <span class="af-hint">{{ artForm.status === 1 ? '保存后前台立即可见' : '存为草稿，前台看不到' }}</span>
        </div>
      </div>

      <div class="af-editor">
        <MdEditor
v-model="artForm.content"
                  theme="dark"
                  :language="zh_CN"
                  :toolbars-exclude="['github', 'fullscreen', 'preview-html']" />
      </div>

      <template #footer>
        <span class="af-foot-tip">正文用 Markdown 写，右侧实时预览</span>
        <el-button @click="artEditVisible = false">取消</el-button>
        <el-button type="primary" :loading="artSaving" @click="saveArticle">保存</el-button>
      </template>
    </el-dialog>
    <!-- ==================== 新建 / 编辑标签弹窗 ==================== -->
    <el-dialog
v-model="tagEditVisible" class="art-edit-modal" :title="tagForm.id ? '编辑标签' : '新建标签'"
               width="min(460px, 92vw)" :close-on-click-modal="false">
      <div class="af-row">
        <span class="ed-label">标签名</span>
        <!-- maxlength 与后端 @Size(max=30) 对齐：前端拦一道只是体验（本地即时反馈），
             真正生效的仍然是后端那一层（直接调接口可以绕过前端） -->
        <el-input
v-model="tagForm.name" placeholder="比如：Vue、部署、读书笔记"
                  maxlength="30" show-word-limit @keyup.enter="saveTag" />
      </div>

      <div class="af-row">
        <span class="ed-label">排序</span>
        <el-input-number v-model="tagForm.sort" :min="0" :max="9999" controls-position="right" />
        <span class="af-hint">越小越靠前</span>
      </div>

      <!-- 【为什么失败原因要显示在弹窗里，而不是只弹一个 toast】
           重名（后端返回 400「标签名已存在」）是这个表单最常见的失败，
           而 toast 三秒后自己就消失了，用户那时还在看弹窗、正准备点第二次保存。
           把原因留在弹窗里 + 弹窗不关闭，用户才能当场改名重试；
           只弹 toast 的表现是"点保存没反应，提示一闪而过"。 -->
      <p v-if="tagFormError" class="ed-error">{{ tagFormError }}</p>

      <template #footer>
        <span class="af-foot-tip">名字首尾的空格会被自动去掉</span>
        <el-button @click="tagEditVisible = false">取消</el-button>
        <el-button type="primary" :loading="tagSaving" @click="saveTag">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'
// Markdown 编辑器。zh_CN 是官方中文语言包（工具栏的鼠标提示、字数统计等都会变中文）
// 样式必须单独引一次 —— 这个库不带自动注入 CSS
import { MdEditor, zh_CN } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'

// 路由守卫：没登录就弹登录框并回首页
definePageMeta({ middleware: 'admin' })

// ================================================================
//  后台页的 SEO 元信息
//
//  【为什么后台也要设 head】不设的话它会继承站点默认标题，看起来像"公开页面"；
//  更要紧的是【必须让它明确不可索引】：
//   · robots 里给 noindex, nofollow —— 后台是登录后才看得见的内部工具，
//     被搜索引擎收录没有任何好处，只有"把管理入口暴露给别人"的风险
//   · 光靠 robots.txt 的 Disallow 是不够的：Disallow 只挡住"抓取"，
//     如果别处有链接指向它，搜索结果里仍然可能出现这个地址（只是没有摘要）。
//     两者都做才算完整（robots.txt 见 server/routes/robots.txt.get.ts）
//
//  【为什么不上全站登录墙】后台的访问控制本来就在 useApi + 路由守卫（middleware/admin），
//  noindex 处理的是"搜索引擎",不是"攻击者"：真正拦住人的是后端接口的 401/403。
// ================================================================
useSeoMetaFor(() => ({
  path: '/admin',
  title: '后台管理',
  description: '亿轨星途的站点后台（仅管理员可见），不对搜索引擎开放。',
  noindex: true,
}))

const { request } = useApi()
const { user } = useAuth()

// 当前登录用户 ID：用来禁用「操作自己」的按钮
const myId = computed(() => user.value?.id)

// ---------- 左侧菜单 ----------
// 「分类 / 标签」那个占位菜单这次拆成了两个真实的页面：
//   · 标签管理：后端已经有完整的增删改查，所以这里是真能用的
//   · 分类：后端【已经】有增删改接口了（AdminCategoryController），
//     但这一批任务里明确不做分类的写操作，所以这里只做只读展示 ——
//     见「分类」那一块模板前的说明
const menus = [
  { key: 'overview', label: '概览' },
  { key: 'articles', label: '文章管理' },
  { key: 'users',    label: '用户管理' },
  { key: 'tags',     label: '标签管理' },
  { key: 'categories', label: '分类' },
  { key: 'settings', label: '设置' },
]
const cur = ref('users')
const curLabel = computed(() => menus.find(m => m.key === cur.value)?.label || '')

// ---------- 列表数据 ----------
const users = ref([])
const total = ref(0)
const loading = ref(false)

// ================================================================
//  概览的四个数字
// ================================================================
// 文章 / 浏览 / 分类：公开接口 GET /article/stats（口径：只统计已发布文章），
// 和首页个人卡片共用同一个 composable，口径与降级行为完全一致。
const { stats: siteStats, failed: statsFailed, load: loadSiteStats } = useSiteStats()

// 用户数是单独一个 ref，不复用用户表格的 total。
// 【为什么】total 是"用户管理页当前查询条件"的总数：管理员在那边筛了"禁用用户"，
// 概览的用户数就会跟着变成禁用用户数 —— 这正是这次要修掉的"数字取决于你点过什么"。
const userCount = ref(0)
const userCountFailed = ref(false)

const fetchUserCount = async () => {
  // size=1：只需要 total 这个总数，不需要真的把那一页数据拉回来
  const res = await request('/user/page', { params: { page: 1, size: 1 } })
  if (res.ok) {
    userCount.value = toCount(res.data?.total)
    userCountFailed.value = false
  } else {
    // 失败就保留旧值 + 显示占位，不把数字清成 0（假装"没有用户"比"读不到"更糟）
    userCountFailed.value = true
  }
}

/**
 * 拉一次概览数据。
 * 【为什么进入后台就要主动拉，而不是等用户点「概览」菜单】
 *   改之前概览的数字来自用户表格 / 文章表格 / 分类列表的变量，而这些表格是
 *   "哪个菜单被点开才加载"的 —— 于是概览显示什么，取决于你点过哪些菜单：
 *   直接进后台点「概览」，四个数字全是 0。现在进入页面就并行拉好。
 */
const loadOverview = () => Promise.all([loadSiteStats(), fetchUserCount()])

/** 数字显示：接口失败显示「—」，不要用 0 冒充一个确定的答案 */
const statText = (value, failed) => (failed ? '—' : value)

// sortField / sortOrder：点表头排序时发给后端（后端有字段白名单校验）
const query = reactive({
  page: 1, size: 10,
  keyword: '', role: '', status: null,
  sortField: '', sortOrder: '',
})

// 表格实例：重置时用来清掉表头的排序箭头
const tableRef = ref()

// ---------- 刷新登录用户信息 ----------
// useState('user') 刷新页面后会变回 null，此时 myId 是 undefined，
// 「不能操作自己」的按钮就会失效，所以用 /auth/me 补一次
const ensureUser = async () => {
  if (user.value?.id) return
  const res = await request('/auth/me')
  if (res.ok) user.value = res.data
}

// ---------- 拉列表 ----------
const fetchUsers = async () => {
  loading.value = true
  const res = await request('/user/page', {
    params: {
      page: query.page,
      size: query.size,
      keyword: query.keyword || undefined,
      role: query.role || undefined,
      status: query.status === null ? undefined : query.status,
      sortField: query.sortField || undefined,
      sortOrder: query.sortOrder || undefined,
    },
  })
  loading.value = false
  if (!res.ok) return
  users.value = res.data.records || []
  total.value = Number(res.data.total) || 0
}

const search = () => { query.page = 1; fetchUsers() }
const reset = () => {
  query.keyword = ''; query.role = ''; query.status = null; query.page = 1
  query.sortField = ''; query.sortOrder = ''
  tableRef.value?.clearSort()      // 清掉表头的排序箭头，回到默认排序
  fetchUsers()
}
const onPageChange = (p) => { query.page = p; fetchUsers() }
const onSizeChange = (s) => { query.size = s; query.page = 1; fetchUsers() }

// ---------- 点表头排序 ----------
// Element Plus 给的是 order: 'ascending' | 'descending' | null
// 我们转成后端约定的 'asc' / 'desc'，空字符串代表"不排序"（后端会用默认排序）
const onSortChange = ({ prop, order }) => {
  query.sortField = order ? prop : ''
  query.sortOrder = order === 'ascending' ? 'asc' : (order === 'descending' ? 'desc' : '')
  query.page = 1                   // 换排序后回到第 1 页
  fetchUsers()
}

// ---------- 启用 / 禁用 ----------
const toggleStatus = async (row) => {
  const next = row.status === 1 ? 0 : 1
  const action = next === 1 ? '启用' : '禁用'
  try {
    await ElMessageBox.confirm('确定要' + action + '用户「' + row.username + '」吗？', '确认操作', {
      type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消',
    })
  } catch { return }

  const res = await request('/user/' + row.id + '/status', {
    method: 'PUT', params: { status: next },
  })
  if (res.ok) { ElMessage.success('已' + action); fetchUsers() }
}

// ---------- 删除用户 ----------
const removeUser = async (row) => {
  try {
    await ElMessageBox.confirm(
      '确定要删除用户「' + row.username + '」吗？删除后该账号将无法再登录。',
      '危险操作',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
  } catch { return }

  const res = await request('/user/' + row.id, { method: 'DELETE' })
  if (res.ok) { ElMessage.success('已删除'); fetchUsers() }
}

// ---------- 编辑弹窗 ----------
const editVisible = ref(false)
const saving = ref(false)
const editForm = reactive({ id: null, username: '', role: 'GUEST', password: '' })

const openEdit = (row) => {
  editForm.id = row.id
  editForm.username = row.username
  editForm.role = row.role
  editForm.password = ''          // 每次打开都清空，避免误改
  editVisible.value = true
}

const saveEdit = async () => {
  const row = users.value.find(u => u.id === editForm.id)
  const roleChanged = row && row.role !== editForm.role
  const pwdChanged = !!editForm.password

  if (!roleChanged && !pwdChanged) {
    ElMessage.info('没有需要保存的修改')
    editVisible.value = false
    return
  }

  saving.value = true
  let allOk = true

  // ① 改角色
  if (roleChanged) {
    const r = await request('/user/' + editForm.id + '/role', {
      method: 'PUT', params: { role: editForm.role },
    })
    if (!r.ok) allOk = false
  }

  // ② 改密码
  if (pwdChanged) {
    const r = await request('/user/' + editForm.id + '/password', {
      method: 'PUT', body: { password: editForm.password },
    })
    if (!r.ok) allOk = false
  }

  saving.value = false
  if (allOk) {
    ElMessage.success('保存成功')
    editVisible.value = false
    fetchUsers()
  }
}

// ================================================================
//  文章管理
// ================================================================

const articles = ref([])
const artTotal = ref(0)
const artLoading = ref(false)
const artTableRef = ref()

// 分类列表：筛选下拉框 + 编辑弹窗里的分类选择都靠它
const categories = ref([])

/**
 * 标签列表（后台接口 GET /admin/tag/list，需要 ADMIN）。
 *
 * 【为什么后台不用前台的 GET /tag/list】两个接口形状一样，差别只有一条：
 *   前台那份**走了缓存**（标签是给访客看的导航，几乎不变），
 *   后台这份不走缓存 —— 管理员刚建完标签就要能在文章的标签下拉框里选到它。
 *   用前台那份的话，新建的标签可能几分钟内都选不到，
 *   而"是不是没保存成功"这种疑惑是后台最不该出现的东西。
 *
 * 【为什么这一个 ref 同时喂两处】文章弹窗的标签下拉框与「标签管理」页共用它：
 *   两处看到的必须是同一批标签，各拉一份迟早会有一处是旧的。
 */
const tags = ref([])

const artQuery = reactive({
  page: 1, size: 10,
  keyword: '', categoryId: null, status: null,
  sortField: '', sortOrder: '',
})

// ---------- 拉分类（公开接口，不需要 token）----------
const fetchCategories = async () => {
  const res = await request('/category/list')
  if (res.ok) categories.value = res.data || []
}

// ---------- 拉标签（后台接口，不走缓存）----------
const fetchTags = async () => {
  const res = await request('/admin/tag/list')
  // 和分类一样用 Array.isArray 兜一道：它会被 v-for 和 .find 用到，
  // 接口挂了 / 结构变了（比如返回 {records:[]}）时兜成空数组，
  // 最差只是下拉框是空的，不会把整个后台渲染带崩
  tags.value = res.ok && Array.isArray(res.data) ? res.data : []
}

// ---------- 拉文章列表 ----------
// 【注意这里打的是 /admin/article/page，不是前台的 /article/page】
// 区别：后台接口带 token 且要求 ADMIN，能看见草稿；前台接口一律隐藏草稿。
// 管理后台当然要看得见自己没写完的草稿，所以走后台接口。
const fetchArticles = async () => {
  artLoading.value = true
  const res = await request('/admin/article/page', {
    params: {
      page: artQuery.page,
      size: artQuery.size,
      keyword: artQuery.keyword || undefined,
      categoryId: artQuery.categoryId === null ? undefined : artQuery.categoryId,
      status: artQuery.status === null ? undefined : artQuery.status,
      sortField: artQuery.sortField || undefined,
      sortOrder: artQuery.sortOrder || undefined,
    },
  })
  artLoading.value = false
  if (!res.ok) return
  articles.value = res.data.records || []
  artTotal.value = Number(res.data.total) || 0
}

const searchArticles = () => { artQuery.page = 1; fetchArticles() }
const resetArticles = () => {
  artQuery.keyword = ''; artQuery.categoryId = null; artQuery.status = null; artQuery.page = 1
  artQuery.sortField = ''; artQuery.sortOrder = ''
  artTableRef.value?.clearSort()
  fetchArticles()
}
const onArtPageChange = (p) => { artQuery.page = p; fetchArticles() }
const onArtSizeChange = (s) => { artQuery.size = s; artQuery.page = 1; fetchArticles() }
const onArtSortChange = ({ prop, order }) => {
  artQuery.sortField = order ? prop : ''
  artQuery.sortOrder = order === 'ascending' ? 'asc' : (order === 'descending' ? 'desc' : '')
  artQuery.page = 1
  fetchArticles()
}

// ---------- 新建 / 编辑弹窗 ----------
const artEditVisible = ref(false)
const artSaving = ref(false)

/**
 * 本次「新建」动作的幂等键。
 *
 * 【为什么是"打开弹窗时生成一次"，而不是"每次点保存生成一次"】
 *   这两者的区别决定了它能不能真正防住重复提交：
 *     · 每次点保存都生成新键 → 用户点两下得到两个不同的键，
 *       后端会认为是两次不同的创建请求，照样写出两篇文章。**拦不住**。
 *     · 打开弹窗时生成一次、保存成功后换新 → 用户点两下带的是【同一个键】，
 *       后端第二次直接返回第一次的结果，只产生一篇文章。**这才拦得住**。
 *   而且还顺带覆盖另一种情况：请求超时了、用户没关弹窗又点了一次保存 ——
 *   同样是同一个键，不会写出第二篇。
 *   用户真想再写一篇时会关掉弹窗重新点「新建文章」，那时才换新键。
 *
 * 【键的生成逻辑在 useIdempotencyKey 里】抽出去是为了能单独测
 *   （"同一个动作里键不变、换动作后键变了"这两条正是它要保证的语义）。
 */
const { rotate: rotateIdempotencyKey, ensure: ensureIdempotencyKey } = useIdempotencyKey()

const artForm = reactive({
  id: null, title: '', summary: '', content: '', cover: '',
  categoryId: null,
  // 选中的标签 id 数组。空数组 = 这篇文章没有标签（不是"不改标签"，见 saveArticle）
  tagIds: [],
  status: 0,      // 默认草稿 —— 安全默认值，避免半成品被直接发出去
  isTop: 0,
})

// ---------- 封面上传 ----------
// 逻辑都在 useUpload 里（含类型/大小的前端预检），这里只负责
// "把界面上发生的事转成调用 + 把结果反馈给用户"
const { upload: uploadCover, ALLOWED_EXTENSIONS, MAX_SIZE_TEXT } = useUpload()
const coverUploading = ref(false)

/**
 * el-upload 选中文件后的回调（auto-upload 关掉时由这个回调接管上传）。
 *
 * 【注意这里拿的是 uploadFile.raw】
 *   el-upload 的 on-change 给的是一个包装对象，真正的浏览器 File 在 .raw 上。
 *   直接把它当 File 用（比如读 .size）会得到 undefined。
 */
const onCoverChosen = async (uploadFile) => {
  const file = uploadFile?.raw
  if (!file) return

  coverUploading.value = true
  try {
    const res = await uploadCover(file)
    if (res.ok && res.url) {
      // 上传成功：把返回的 URL 回填到表单，保存文章时一起提交
      artForm.cover = res.url
      ElMessage.success('封面上传成功')
    } else {
      // 失败时提示后端给的具体原因（比如"只允许上传 xxx 格式的图片"），
      // 而不是笼统的"上传失败"—— 用户看着提示才知道该怎么改
      ElMessage.error(res.message || '封面上传失败')
    }
  } finally {
    // 放在 finally 里：不管成功失败都要把 loading 收掉，
    // 否则一次异常就会让按钮永久转圈
    coverUploading.value = false
  }
}

const resetArtForm = () => {
  artForm.id = null
  artForm.title = ''
  artForm.summary = ''
  artForm.content = ''
  artForm.cover = ''
  artForm.categoryId = null
  // 新建时是空数组（"还没打标签"），不是上一篇文章的标签 ——
  // 不清的话会出现"新建的文章莫名其妙带着上一篇的标签"
  artForm.tagIds = []
  artForm.status = 0
  artForm.isTop = 0
}

const openCreate = () => {
  resetArtForm()
  // 每次「新建」都换一个新幂等键：这一次动作里的所有重复点击共用它。
  // 详见上面 newArticleIdempotencyKey 的注释（为什么不是每次点保存才生成）。
  rotateIdempotencyKey()
  // 打开弹窗顺手刷新标签选项：用户很可能刚在「标签管理」里建完标签就来写文章。
  // 不 await —— 下拉框的数据晚几十毫秒到没关系，不该因此拖慢弹窗出现
  fetchTags()
  artEditVisible.value = true
}

// 打开编辑：这里有个容易踩的坑 ——
// 列表接口【不返回正文】(后端特意排除了 content 这个大字段，为了省带宽)，
// 所以点开编辑时必须再单独拉一次详情，否则编辑器里是空的，
// 一保存就把正文清空了。
const openArticleEdit = async (row) => {
  resetArtForm()
  artForm.id = row.id
  artForm.title = row.title
  artForm.summary = row.summary || ''
  artForm.cover = row.cover || ''
  artForm.categoryId = row.categoryId
  artForm.status = row.status
  artForm.isTop = row.isTop
  // 列表项其实也带着 tags，先用它回显，这样即使详情接口慢了/挂了，
  // 下拉框里也是这篇真实的标签，而不是空着（空着会让用户以为"这篇没标签"，
  // 一保存就把标签全清了）
  artForm.tagIds = tagIdsOf(row.tags)

  // 标签选项与文章详情并行拉（两者互不依赖，串行要等两个往返）
  const [, detail] = await Promise.all([
    fetchTags(),
    request('/admin/article/' + row.id),
  ])

  if (detail.ok) {
    artForm.content = detail.data.content || ''
    // 【以详情为准】详情里的 tags 是这篇文章最新的标签；
    // 列表那一份可能是几分钟前拉的（别人刚改过标签时就会不一致）。
    // 注意要用 Array.isArray 兜底：tags 缺失时不能把已回显的标签清成空数组。
    if (Array.isArray(detail.data.tags)) artForm.tagIds = tagIdsOf(detail.data.tags)
  }

  artEditVisible.value = true
}

/**
 * 把接口给的 tags（对象数组）转成表单要的 id 数组。
 * 【为什么要过滤一遍】表单里只需要 id，而 tags 里还带着 name/sort/articleCount；
 * 顺手把非数字的项丢掉，避免一个脏数据让 el-select 回显不出来
 * （那种情况的表现是"标签明明有，弹窗里却是空的"，最难查）。
 */
const tagIdsOf = (list) => (Array.isArray(list) ? list.map(t => t?.id).filter(id => Number.isInteger(id)) : [])

const saveArticle = async () => {
  if (!artForm.title.trim()) {
    ElMessage.warning('标题不能为空')
    return
  }

  // 【第一道防线：连点直接不理】
  //   按钮上虽然有 :loading="artSaving"（加载中会禁用），
  //   但那是"界面上的防线"——它依赖按钮真的被渲染成禁用态。
  //   在极快连点（两次点击落在同一帧）时，第一次点击设置的 artSaving
  //   还没来得及让浏览器重绘，第二次点击就已经进来了。
  //   所以这里再拦一道：状态已经是"保存中"就直接返回。
  if (artSaving.value) return

  artSaving.value = true

  // 空字符串一律转成 null 提交：
  // 后端 update 用的是显式 SET，传 null 会真的把该字段清空，
  // 传 '' 则会往库里写一个空字符串。语义上"没填"应该是 null。
  const body = {
    title: artForm.title.trim(),
    summary: artForm.summary || null,
    content: artForm.content || null,
    cover: artForm.cover || null,
    categoryId: artForm.categoryId,
    // 【tagIds 永远传，一个都不选时是 []】
    //   后端这两个接口对标签是【覆盖式】语义：不传这个字段、和传空数组，
    //   结果都是"清空这篇文章的标签"（先删关联、再按传入的 id 重建）。
    //   既然两者等价，那就显式传一个空数组 —— 它把"我就是要清空"这个意图
    //   写在了请求体里，看日志的人一眼能分辨"用户清空了标签"
    //   和"前端忘了传这个字段"（后者是 bug，两者在后端看起来一样）。
    //   另外传一个不存在的标签 id 时后端返回 404 并且【不会动原有的标签】
    //   （校验先于写入），所以这里不需要先自己校验一遍 id 是否存在。
    tagIds: [...artForm.tagIds],
    status: artForm.status,
    isTop: artForm.isTop,
  }

  const isEdit = !!artForm.id

  // 【第二道防线：后端幂等】
  //   上面那道只挡得住"同一个页面里的连点"，挡不住：
  //     · 请求超时了、用户刷新页面又提交一次
  //     · 代理/网关重试把同一个请求发了两次
  //   所以新建时带上一个幂等键（后端认这个键去重，见 IdempotencyService）。
  //   编辑（PUT）不带 —— 编辑本身就是幂等的，执行两次结果一样，加了没意义。
  const res = isEdit
    ? await request('/admin/article/' + artForm.id, { method: 'PUT', body })
    : await request('/admin/article', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': ensureIdempotencyKey() },
      })

  artSaving.value = false

  if (res.ok) {
    ElMessage.success(isEdit ? '已保存' : '文章已创建')
    // 保存成功后才换新键：这样"这一篇"的整个提交过程（含各种重试）
    // 都共用同一个键，下一次新建才是新的动作
    if (!isEdit) rotateIdempotencyKey()
    artEditVisible.value = false
    fetchArticles()
  }
}

// ---------- 发布 / 下架 ----------
const toggleArticleStatus = async (row) => {
  const next = row.status === 1 ? 0 : 1
  const action = next === 1 ? '发布' : '下架'
  const tip = next === 1
    ? '确定要发布《' + row.title + '》吗？发布后前台立即可见。'
    : '确定要下架《' + row.title + '》吗？下架后前台立刻看不到它。'

  try {
    await ElMessageBox.confirm(tip, '确认' + action, {
      type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消',
    })
  } catch { return }

  const res = await request('/admin/article/' + row.id + '/status', {
    method: 'PUT', params: { status: next },
  })
  if (res.ok) { ElMessage.success('已' + action); fetchArticles() }
}

// ---------- 删除文章 ----------
const removeArticle = async (row) => {
  try {
    await ElMessageBox.confirm(
      '确定要删除《' + row.title + '》吗？删除后前台将不再可见。',
      '危险操作',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
  } catch { return }

  const res = await request('/admin/article/' + row.id, { method: 'DELETE' })
  if (res.ok) { ElMessage.success('已删除'); fetchArticles() }
}

// ---------- 时间格式化 ----------
const fmtTime = (t) => (t ? String(t).replace('T', ' ').slice(0, 19) : '—')

// ================================================================
//  标签管理（增删改查）
//
//  【数据源就是上面那个 tags（GET /admin/tag/list）】
//   文章弹窗的下拉框与这个列表看的是同一份，所以在这里新建一个标签之后，
//   那个下拉框立刻就有它 —— 不需要"再刷新一次页面才能选到"。
//   这也是为什么全文只有一个 tags ref：两处各拉一份迟早会有一处是旧的。
// ================================================================

const tagLoading = ref(false)
const tagSaving = ref(false)
const tagEditVisible = ref(false)
/** 保存失败时显示在弹窗里的原因（见模板里那段说明：toast 会消失，弹窗不会） */
const tagFormError = ref('')

const tagForm = reactive({ id: null, name: '', sort: 0 })

/** 带 loading 的刷新（切到标签菜单时用；弹窗里那个「刷新」按钮走 fetchTags 也够） */
const loadTags = async () => {
  tagLoading.value = true
  await fetchTags()
  tagLoading.value = false
}

const openTagCreate = () => {
  tagForm.id = null
  tagForm.name = ''
  // 排序默认 0：后端的排序规则是"越小越靠前"，0 是它的默认值。
  // 这里不自动算 max+1 —— 自动算出来的数字用户看不懂（"为什么是 7？"），
  // 而绝大多数标签用默认值就够了，想调的人自己会去改。
  tagForm.sort = 0
  tagFormError.value = ''
  tagEditVisible.value = true
}

const openTagEdit = (row) => {
  tagForm.id = row.id
  tagForm.name = row.name || ''
  // sort 可能是 null（后端允许不传）。el-input-number 拿到 null 会显示成空，
  // 用户一保存就把排序变成 0 —— 所以这里显式兜成 0
  tagForm.sort = Number(row.sort) || 0
  tagFormError.value = ''
  tagEditVisible.value = true
}

/**
 * 保存标签（新建或编辑）。
 *
 * 【提交前必须 trim】后端会 trim 之后再查重（"工作" 与 " 工作 " 是同一个名字），
 *   而这里是"同一套规则的显示端"：不 trim 的话，用户输入 " 工作 " 时
 *   我们会把带空格的字符串发上去（后端能处理，但请求体和日志里都是脏数据），
 *   而且 maxlength=30 会因为空格而提前截断一个本来合法的名字。
 *
 * 【为什么前端也校验一遍长度和必填】和封面那套一样，前端预检只是体验优化
 *   （本地即时反馈、不浪费一次往返），真正生效的永远是后端那一层。
 */
const saveTag = async () => {
  tagFormError.value = ''

  const name = tagForm.name.trim()
  if (!name) {
    tagFormError.value = '标签名不能为空'
    return
  }
  if (name.length > 30) {
    tagFormError.value = '标签名最长 30 字'
    return
  }
  // 防连点：按钮上虽然有 :loading，但两次点击落在同一帧时它还没重绘
  if (tagSaving.value) return

  tagSaving.value = true
  const body = { name, sort: Number(tagForm.sort) || 0 }
  const isEdit = !!tagForm.id

  const res = isEdit
    ? await request('/admin/tag/' + tagForm.id, { method: 'PUT', body })
    : await request('/admin/tag', { method: 'POST', body })

  tagSaving.value = false

  if (res.ok) {
    ElMessage.success(isEdit ? '已保存' : '标签已创建')
    tagEditVisible.value = false
    // 重新拉列表（而不是把新的这一条塞进本地数组）：sort 是后端排的，
    // 本地插进去的位置不一定对；而且 articleCount 只有后端算得准
    fetchTags()
    return
  }

  // 【失败：弹窗留着 + 把后端的原因写在弹窗里】
  //   最典型的就是重名：后端返回 400 + 「标签名已存在」。
  //   useApi 已经弹过一次 toast（那句话就是后端的原文），这里再显示一遍是为了
  //   "留在用户眼前" —— 重名时他要做的动作是改名字再点一次保存，
  //   而 toast 三秒后消失，那时他还在看这个弹窗。
  tagFormError.value = res.message || '保存失败，请稍后再试'
}

/**
 * 删除标签。
 *
 * 【二次确认里必须说清"会同时解除文章关联"】
 *   后端这个删除是【物理删除】：标签行删掉，同时把它与文章的所有关联一起删掉
 *   （文章本身不会消失，只是少了这个标签）。用户在列表上看到的就是一个名字，
 *   不告诉他的话很容易以为"只是从标签库里去掉了，文章上的标签还在"。
 *   所以确认框里把影响写全：有几篇已发布文章也报出来（articleCount 就是为这个准备的）。
 */
const removeTag = async (row) => {
  const count = Number(row.articleCount) || 0
  const impact = count > 0
    ? `它下面还有 ${count} 篇已发布文章，删除后会同时解除这些文章与它的关联（文章本身不会被删除）。`
    : '目前没有文章使用它。'

  try {
    await ElMessageBox.confirm(
      `确定要删除标签「${row.name}」吗？${impact}删除后无法恢复。`,
      '危险操作',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消' },
    )
  } catch { return }

  const res = await request('/admin/tag/' + row.id, { method: 'DELETE' })
  if (res.ok) {
    ElMessage.success('已删除')
    fetchTags()
    return
  }
  // 【404 = 别人（或另一个标签页）已经把它删掉了】
  //   这时什么都不做的话，用户看到的是一条"标签不存在"的报错 + 一个还列着它的表格，
  //   他会以为删除失败、再点一次。刷新列表才是能自愈的做法：表格里那条自己就没了。
  if (res.code === 404) {
    ElMessage.warning('这个标签已经不在了，列表已刷新')
    fetchTags()
  }
}

// 切到文章管理时如果还没加载过，补一次；切到概览时刷新一次概览数据
// （比如刚从文章管理发布/删除了文章，回到概览看到的应该是新的数字，而不是进页面那一刻的）
// 标签管理同理：在别处（文章弹窗、另一个标签页）改过标签之后切过来，
// 看到的应该是当前的标签，而不是进页面那一刻的快照
watch(cur, (v) => {
  if (v === 'articles' && articles.value.length === 0) fetchArticles()
  if (v === 'overview') loadOverview()
  if (v === 'tags') loadTags()
})

onMounted(async () => {
  // 这几件事互不依赖，并行发出去（Promise.all 而不是一个个 await，省几个来回的网络时间）
  await ensureUser()
  await Promise.all([fetchUsers(), fetchCategories(), fetchTags(), fetchArticles(), loadOverview()])
})
</script>

<style scoped>
.admin { display: flex; gap: 24px; max-width: 1440px; margin: 0 auto; padding: 32px; min-height: 70vh; }
/* 毛玻璃降档：blur 14->10 并去掉 saturate()，减轻背景视频播放时的每帧开销 */
.glass { background: rgba(36,54,92,.34); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid rgba(180,210,245,.14); box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }

.side { width: 220px; flex-shrink: 0; border-radius: 20px; padding: 24px 18px; height: fit-content; }
.side-brand { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 15px; margin-bottom: 24px; }
.side-brand .mk { color: var(--accent); }
.side-nav { display: flex; flex-direction: column; gap: 6px; }
.side-nav a { padding: 10px 14px; border-radius: 12px; color: var(--muted); cursor: pointer; transition: background .2s, color .2s; }
.side-nav a:hover { color: var(--ink); background: rgba(255,255,255,.05); }
.side-nav a.active { color: var(--accent); background: rgba(242,193,78,.12); font-weight: 600; }

.main { flex: 1; min-width: 0; }
.top { margin-bottom: 24px; }
.top h1 { font-size: 30px; font-weight: 800; margin: 0 0 8px; }
.top p { color: var(--muted); margin: 0; }

.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
.stat { border-radius: 18px; padding: 22px; display: flex; flex-direction: column; gap: 10px; }
.stat span { color: var(--muted); font-size: 13px; }
.stat b { font-size: 34px; font-weight: 800; color: var(--accent); }

.panel {
  border-radius: 20px;
  padding: 24px;
  /* 排序箭头图标，见下方「排序箭头」一节。
     用 data URI 内联一个 16x16 的 SVG，配合 mask 使用。
     %20 是空格的 URL 编码（data URI 里空格必须转义），解码后的真面目是：
       <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'>
         <path d='M8 13.5V3.8M8 3.8L3.9 7.9M8 3.8L12.1 7.9'
               fill='none' stroke='black' stroke-width='2.1'
               stroke-linecap='round' stroke-linejoin='round'/>
       </svg>
     就是【一条竖线 + 一个箭头帽】。配合 mask 用而不是直接当图片，
     是因为这样才能用 background-color 自由改颜色，跟着主题走。 */
  --sort-arrow: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E%3Cpath%20d='M8%2013.5V3.8M8%203.8L3.9%207.9M8%203.8L12.1%207.9'%20fill='none'%20stroke='black'%20stroke-width='2.1'%20stroke-linecap='round'%20stroke-linejoin='round'/%3E%3C/svg%3E");
}
.panel-head { font-weight: 700; margin-bottom: 18px; }
.empty { color: var(--muted); text-align: center; padding: 40px 0; font-size: 14px; }

.toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; border-radius: 18px; padding: 16px 18px; margin-bottom: 20px; }
.tb-item { width: 180px; }
/* 工具条上的说明文字（标签管理那句"这里建完立刻就能选到"）：靠右、弱化，
   它解释的是"这个页面和别处的关系"，不是必须读的操作指引 */
.tb-hint { color: var(--muted); font-size: 12px; margin-left: auto; }
.pager { display: flex; justify-content: flex-end; margin-top: 18px; }

/* 面板顶部的一行说明（分类那页的"只读"提示）。
   用左边一条竖线而不是纯文字：它需要被看见，但不需要抢标题的位置 */
.panel-note {
  color: var(--muted); font-size: 13px; line-height: 1.7;
  border-left: 3px solid rgba(242,193,78,.5); padding: 2px 0 2px 12px; margin-bottom: 18px;
}
.panel-note strong { color: var(--accent); }

/* 弹窗里的失败原因（比如「标签名已存在」）。
   用主题里的错误色而不是灰色：它是一条"必须处理才能继续"的信息 */
.ed-error {
  color: var(--el-color-danger, #f56c6c);
  font-size: 13px; line-height: 1.6; margin: 4px 0 0;
}

/* 编辑弹窗内的行 */
.ed-row { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
.ed-label { width: 72px; flex-shrink: 0; color: var(--muted); font-size: 13px; }
.ed-static { color: var(--ink); font-weight: 600; }
.ed-tip { color: var(--muted); font-size: 12px; margin: 4px 0 0; line-height: 1.6; }

/* ===== 文章管理 ===== */
/* 标题和「置顶」「分类」两个小标签挤在一行，省掉一整个「分类」列的位置 */
.art-title { color: var(--ink); font-weight: 600; }
.art-tag { margin-left: 8px; }

/* 文章编辑弹窗的表单行：标签固定宽度，输入框吃掉剩余空间 */
.af-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.af-row .ed-label { width: 56px; }
.af-row > .el-input,
.af-row > .el-select { flex: 1; }

.af-opts { display: flex; align-items: center; gap: 28px; flex-wrap: wrap; }
.af-hint { color: var(--muted); font-size: 12px; }

/* ---------- 封面：预览 + 上传按钮 ---------- */
/* 用 flex-wrap 让窄屏时按钮自动换到预览图下面，而不是把布局挤变形 */
.cover-field { flex: 1; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
/* 固定高度 + object-fit: cover：不同长宽比的封面在这里都显示成统一大小的缩略图，
   不用去裁剪原图，也不会把表单撑高 */
.cover-preview { height: 64px; width: 96px; object-fit: cover; border-radius: 8px;
  border: 1px solid rgba(150,190,240,.18); background: #0d1b38; }
.cover-btns { display: flex; align-items: center; gap: 8px; }

.af-editor { margin-top: 8px; }
/* 编辑器这一块不参与 .af-row 的垂直居中对齐 */
.af-editor .md-editor { border: 1px solid rgba(150,190,240,.18); }

/* 弹窗底部：提示语靠左，按钮靠右 */
.af-foot-tip { color: var(--muted); font-size: 12px; margin-right: auto; }

/* 概览页的「最近文章」 */
.recent { list-style: none; margin: 0; padding: 0; }
.recent li {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 12px 4px; border-bottom: 1px solid rgba(150,190,240,.10);
}
.recent li:last-child { border-bottom: none; }
.r-title { color: var(--ink); font-weight: 600; }
.r-meta { display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: 12px; }

/* ===== Element Plus 暗色适配 ===== */
.panel, .toolbar, .user-edit-modal {
  --el-bg-color: transparent;
  --el-fill-color-blank: rgba(255,255,255,.06);
  --el-text-color-primary: var(--ink);
  --el-text-color-regular: var(--ink);
  --el-text-color-placeholder: var(--muted);
  --el-border-color: rgba(150,190,240,.18);
  --el-border-color-light: rgba(150,190,240,.14);
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: rgba(255,255,255,.05);
  --el-table-text-color: var(--ink);
  --el-table-header-text-color: var(--muted);
  --el-table-border-color: rgba(150,190,240,.14);
  --el-table-row-hover-bg-color: rgba(242,193,78,.10);
  --el-pagination-bg-color: rgba(255,255,255,.06);
  --el-pagination-text-color: var(--muted);
  --el-pagination-button-color: var(--muted);
  --el-pagination-button-bg-color: rgba(255,255,255,.06);
  --el-pagination-hover-color: var(--accent);
}
.panel :deep(.el-table) { background: transparent; font-size: 13px; }
.panel :deep(.el-table__inner-wrapper::before) { display: none; }
.panel :deep(.el-table th.el-table__cell),
.panel :deep(.el-table td.el-table__cell) { background: transparent; }

/* ===== 排序箭头：单箭头 + 旋转动画 =====
   Element Plus 默认是"上下两个小三角"叠着放，信息量小、还占 24px 宽度。
   这里换成【单个箭头】：升序朝上、降序朝下（原地转 180°），切换时带旋转动画。

   为什么纯 CSS 就能做到、不用改模板：
   EP 会把当前排序状态直接写成 th 上的 class ——
     未排序：th 上没有任何状态类
     升    序：th 带 .ascending
     降    序：th 带 .descending
   所以我们只要盯住这两个类，就能驱动箭头的样子。 */

/* ① 干掉 EP 默认的两个小三角 */
.panel :deep(.el-table th .sort-caret) { display: none; }

/* ② 把箭头容器收成 16x16 的居中盒子（原来 24px 宽，省下 8px 给列内容） */
.panel :deep(.el-table th .caret-wrapper) {
  width: 16px;
  height: 16px;
  padding: 0;
  margin-left: 3px;
  justify-content: center;
  background: none;   /* 它其实是个 <button>，清掉浏览器默认底色和边框 */
  border: none;
}

/* ③ 用 ::before 画出箭头本身 */
.panel :deep(.el-table th .caret-wrapper::before) {
  content: '';
  width: 13px;
  height: 13px;
  /* 颜色由 background-color 决定，形状由 mask 从 SVG 里"抠"出来 */
  background-color: rgba(190,210,240,.45);      /* 未排序：淡淡的灰蓝 */
  -webkit-mask: var(--sort-arrow) center / contain no-repeat;
  mask: var(--sort-arrow) center / contain no-repeat;
  /* 旋转动画：cubic-bezier 带一点点回弹，转起来更有"手感"，
     而不是生硬地一下转过去。
     注意这里【不加】 translateZ(0)：现代浏览器做 transform 过渡时会自动上合成层，
     手动强制提层反而会让 mask 出来的图形被栅格化、边缘发虚。 */
  transition: transform .34s cubic-bezier(.34,1.4,.64,1), background-color .25s;
  transform: rotate(0deg);
}

/* ④ 鼠标悬停时提亮，暗示"这里可以点"
   注意 :not(.ascending):not(.descending) —— 必须排掉正在生效的列。
   因为 CSS 里 :hover 这条规则的选择器类数比第⑤条多，
   优先级更高；不排除的话，鼠标停在已排序列上会把金色盖成灰色。 */
.panel :deep(.el-table th.is-sortable:hover:not(.ascending):not(.descending) .caret-wrapper::before) {
  background-color: rgba(190,210,240,.9);
}

/* ⑤ 当前正在生效的列，箭头点亮成主题金 */
.panel :deep(.el-table th.ascending .caret-wrapper::before),
.panel :deep(.el-table th.descending .caret-wrapper::before) {
  background-color: var(--accent);
}

/* ⑥ 降序 = 把升序的箭头原地旋转 180°（配合上面的 transition 就是动画） */
.panel :deep(.el-table th.descending .caret-wrapper::before) {
  transform: rotate(180deg);
}

/* ⑦ 尊重系统的"减少动态效果"设置：开了就取消旋转动画，直接切换 */
@media (prefers-reduced-motion: reduce) {
  .panel :deep(.el-table th .caret-wrapper::before) { transition: none; }
}

/* ===== 表格列宽 / 固定列修复 =====
   现象：右侧「操作」列的按钮和「创建时间」的文字叠在一起。
   根因有两层，缺一不可：
     ① 列宽合计 980px 超过了表格可用宽度 842px —— 表格横向溢出，
        而 fixed="right" 的「操作」列会被【钉在容器右边缘】，
        正好压在「创建时间」列上（实测重叠 138px）；
     ② 上面的暗色主题把表格背景设成了 transparent，固定列因此没有
        不透明底色，下层文字直接透上来 —— 看起来就是"字叠字"。
   所以两手都要抓：收窄列宽治本，给固定列补底色兜底。 */
.panel :deep(.el-table .el-button + .el-button) { margin-left: 8px; }
.panel :deep(.el-table .el-button--small) { padding: 5px 10px; }

/* 固定列兜底：只在【真的会溢出】的窄窗口下才给固定列加底色。
   为什么：桌面宽度下表格已经装得下，固定列根本没压住任何内容，
           这时再给它加底色，反而会凭空多出一个色块，和毛玻璃面板格格不入。
   何时需要：实测窗口 < 900px 时，容器会小于 798px 的列宽合计，表格开始横向滚动，
           「操作」列就会压住「创建时间」—— 这时必须挡住下层文字。
   注意【不能写死纯色】：面板是半透明叠在背景视频上的，底色每帧都在变，
           写死颜色必然对不上。用「半透明底 + 背景模糊」，它跟着背景一起变，永远吻合。 */
@media (max-width: 900px) {
  .panel :deep(.el-table-fixed-column--left),
  .panel :deep(.el-table-fixed-column--right) {
    background: rgba(18,30,56,.78) !important;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
}

/* 中等宽度：收窄侧边栏和内边距，把空间让给表格 */
@media (max-width: 1300px) {
  .admin { padding: 24px; }
  .side { width: 176px; }
}

/* 窄于 1180px：侧边栏改成横向顶栏，把整幅宽度让给表格。
   原来只在 820px 才折叠，导致 1000~1180px 这段窗口表格仍然装不下，
   「操作」列会重新压到「创建时间」上。 */
@media (max-width: 1180px) {
  .admin { flex-direction: column; padding: 20px; }
  .side { width: 100%; }
  .side-nav { flex-direction: row; flex-wrap: wrap; }
}

@media (max-width: 820px) {
  .admin { padding: 20px; }
  .stats { grid-template-columns: repeat(2,1fr); }
  .tb-item { width: 100%; }
}
</style>

<!-- 全局样式：teleport 到 body 的弹层（下拉框 / 确认框 / 弹窗） -->
<style>
.el-select-dropdown {
  background: #16264a !important;
  border: 1px solid rgba(150,190,240,.18) !important;
}
.el-select-dropdown__item { color: var(--muted) !important; }
.el-select-dropdown__item.is-hovering { background: rgba(242,193,78,.12) !important; color: var(--ink) !important; }
.el-select-dropdown__item.is-selected { color: var(--accent) !important; font-weight: 700; }
.el-popper__arrow::before { background: #16264a !important; border-color: rgba(150,190,240,.18) !important; }

.el-message-box {
  background: #16264a !important;
  border: 1px solid rgba(150,190,240,.18) !important;
}
.el-message-box__title, .el-message-box__content { color: var(--ink) !important; }

.el-dialog.user-edit-modal {
  background: #16264a !important;
  border: 1px solid rgba(150,190,240,.18) !important;
  border-radius: 18px;
}
.user-edit-modal .el-dialog__title { color: var(--ink) !important; }
.user-edit-modal .el-dialog__body { color: var(--ink) !important; padding-top: 8px; }

/* ==================== 文章编辑弹窗 ==================== */
.el-dialog.art-edit-modal {
  background: #16264a !important;
  border: 1px solid rgba(150,190,240,.18) !important;
  border-radius: 18px;
}
.art-edit-modal .el-dialog__title { color: var(--ink) !important; }
.art-edit-modal .el-dialog__body { color: var(--ink) !important; padding-top: 8px; }
/* 底部改成 flex，这样「正文用 Markdown 写」的提示能靠左、按钮靠右 */
.art-edit-modal .el-dialog__footer { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

/* ==================== 弹窗高度自适应 ====================
   【为什么必须做这件事】
   原来的弹窗内容是写死高度的（表单 5 行 + 编辑器 460px ≈ 840px）。
   实测：视口 900px 时「保存」按钮在 827~859，勉强可见；
        视口 800px 时跑到 823~855 —— 已经在屏幕外了。
   笔记本不最大化窗口（768~800px 高）就会踩到，用户得滚动才能点保存，
   很容易以为"没保存按钮"。

   解法：让弹窗自己不超过视口，正文区内部滚动，
   标题栏和底部按钮固定不动 —— 保存按钮永远在视野里。 */
.el-dialog.art-edit-modal {
  display: flex;
  flex-direction: column;
  max-height: 92vh;
  /* EP 默认给弹窗底部留 50px 外边距，加上 4vh 的顶部间距会顶出视口，
     这里压到 2vh。注意要 !important，因为 EP 是用简写 margin 设的。 */
  margin-bottom: 2vh !important;
}
.art-edit-modal .el-dialog__body {
  flex: 1;
  min-height: 0;          /* flex 子项默认 min-height:auto，不归零的话内部滚不起来 */
  overflow-y: auto;
}
/* 编辑器高度跟着视口走：clamp(最小, 期望, 最大)
   期望值 = 视口高 - 400px（表单行 + 标题栏 + 底栏的固定开销）
   视口高 1200 → 560（撞上限）；1000 → 520；800 → 400；700 → 300；再矮保底 240

   【这个库自带 .md-editor { height: 500px } 默认值，必须覆盖掉，否则永远是 500px】

   注意这里【不能写 :deep()】！
   :deep() 是 Vue SFC 的编译期语法，只在 <style scoped> 里被处理。
   写在全局 <style> 块里，它会原样保留在 CSS 里 —— 浏览器不认识 :deep 这个伪类，
   整条规则会被静默丢弃，怎么调都不生效（这次就踩了这个坑：高度一直卡在 500px）。 */
.af-editor .md-editor {
  height: clamp(240px, calc(92vh - 400px), 560px);
}

/* ==================== md-editor-v3 暗色适配 ====================
   这个库自带一套暗色主题（.md-editor-dark），默认是偏中性的灰黑。
   这里把它的主题变量换成博客的暗金蓝，让它和面板融为一体。
   --md-* 是它公开的主题变量，改这些比去覆盖内部类名稳妥得多
   （内部类名会随版本变，而这两个变量是它的公开 API）。 */
.md-editor-dark {
  --md-bk-color: #101d38;                              /* 编辑区底色 */
  --md-bk-color-outstand: rgba(255,255,255,.05);       /* 工具栏底色 */
  --md-bk-hover-color: rgba(242,193,78,.12);           /* 悬停高亮 */
  --md-border-color: rgba(150,190,240,.18);
  --md-border-hover-color: rgba(242,193,78,.45);
  --md-border-active-color: #f2c14e;                   /* 当前激活的工具栏按钮 = 主题金 */
  --md-color: var(--ink);
  --md-hover-color: #ffffff;
  --md-scrollbar-bg-color: rgba(255,255,255,.04);
  --md-scrollbar-thumb-color: rgba(150,190,240,.28);
  border-radius: 14px;
  overflow: hidden;
}
</style>
