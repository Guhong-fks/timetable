package com.fksguh.coursetableapp.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import com.fksguh.coursetableapp.R
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import kotlin.math.roundToInt

/**
 * 课表桌面小组件 Provider。
 *
 * 数据源：App（JS 侧）通过 @bittingz/expo-widgets 的 setWidgetData() 写入
 * SharedPreferences（名称 = <applicationId>.widgetdata，key = widgetdata），
 * payload 结构：
 *   {
 *     "currentWeek": int,
 *     "semesterStartDate": "yyyy-MM-dd"|"",
 *     "courses": [WidgetCourseData...],
 *     "periodTimes": {"1":"08:00",...},       // 节次开始时间（用户可在 App 配置）
 *     "periodDurations": {"1":45,...}         // 节次时长（分钟）
 *   }
 *
 * 每次 onUpdate（系统定时 updatePeriodMillis / App 写入数据后库自动广播 /
 * 下课时刻 AlarmManager 自动刷新）时：
 *   1. 有 semesterStartDate 则重算当前周（避免 App 长期未打开导致周次过期）；
 *   2. 按“当前周 + 当天星期”过滤课程；
 *   3. “下课过滤”：结束时间已过的课程不再显示（进行中/未开始保留）；
 *   4. 读取小组件实际尺寸做响应式渲染（竖排/横排、1~3 门课、周次/日期头部）；
 *   5. 用 AlarmManager 在下一个下课时刻安排自动刷新，实现“下课即消失”；
 *   6. 点击跳回 App（coursetableapp://widget）。
 *
 * 说明：不再使用自定义闹钟做周期刷新，统一依赖 widget_timetable_info.xml 的
 * updatePeriodMillis 系统级兜底 + App 写入时即时刷新 + 下课时刻精确刷新。
 */
class TimetableWidgetProvider : AppWidgetProvider() {

    companion object {
        /** 库 setWidgetData 写入的 SharedPreferences 名 = packageName + ".widgetdata" */
        private fun prefsName(packageName: String) = "$packageName.widgetdata"
        private const val KEY_DATA = "widgetdata"
        private const val SCHEME = "coursetableapp"

        /** 下课自动刷新广播 action */
        private const val ACTION_REFRESH = "com.fksguh.coursetableapp.action.WIDGET_REFRESH"

        /** 默认节次时间规则（与 App 侧 createDefaultPeriodTimes 一致）：第 N 节 = 08:00 + (N-1)*50min，每节 45 分钟 */
        private const val FIRST_PERIOD_MINUTES = 8 * 60
        private const val PERIOD_STEP_MINUTES = 50
        private const val DEFAULT_PERIOD_MINUTES = 45

        /**
         * 桌面网格单元高度（dp/格）。由实测推算：3×2 小组件 options 高度 ≈ 183dp
         * （2 格）→ 约 91.5dp/格。课程显示上限按“高度格子数”决定：
         * 2 格至多 2 节、3 格至多 3 节（横排同样受此限制）。
         */
        private const val CELL_HEIGHT_DP = 91.5f

        private val DAY_KEYS = arrayOf(
            "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
        )
        private val WEEKDAY_CN = arrayOf("周日", "周一", "周二", "周三", "周四", "周五", "周六")

        /** 竖排卡片视图组（容器 / 左侧色条 / 课程名 / 补充信息），最多 6 门课 */
        private val V_CONTAINERS = intArrayOf(
            R.id.course1_container, R.id.course2_container, R.id.course3_container,
            R.id.course4_container, R.id.course5_container, R.id.course6_container
        )
        private val V_ACCENTS = intArrayOf(
            R.id.course1_accent, R.id.course2_accent, R.id.course3_accent,
            R.id.course4_accent, R.id.course5_accent, R.id.course6_accent
        )
        private val V_NAMES = intArrayOf(
            R.id.course1_name, R.id.course2_name, R.id.course3_name,
            R.id.course4_name, R.id.course5_name, R.id.course6_name
        )
        private val V_METAS = intArrayOf(
            R.id.course1_meta, R.id.course2_meta, R.id.course3_meta,
            R.id.course4_meta, R.id.course5_meta, R.id.course6_meta
        )

        /** 横排卡片视图组（宽屏模式），最多 6 列 */
        private val H_CONTAINERS = intArrayOf(
            R.id.hcourse1_container, R.id.hcourse2_container, R.id.hcourse3_container,
            R.id.hcourse4_container, R.id.hcourse5_container, R.id.hcourse6_container
        )
        private val H_NAMES = intArrayOf(
            R.id.hcourse1_name, R.id.hcourse2_name, R.id.hcourse3_name,
            R.id.hcourse4_name, R.id.hcourse5_name, R.id.hcourse6_name
        )
        private val H_METAS = intArrayOf(
            R.id.hcourse1_meta, R.id.hcourse2_meta, R.id.hcourse3_meta,
            R.id.hcourse4_meta, R.id.hcourse5_meta, R.id.hcourse6_meta
        )

        /**
         * 课卡色板：与 App 课程表（src/app/(tabs)/index.tsx COURSE_PALETTE）完全一致，
         * 按课程名 hash 取色，保证同一门课在小组件和 App 里颜色相同。
         * color 为实色（用于左侧色条），bgRes 为该色 14% 透明度的圆角卡背景。
         */
        private val COURSE_PALETTE = arrayOf(
            Palette(0xFF4A90D9.toInt(), R.drawable.widget_course_blue),   // blue
            Palette(0xFF5BAE6E.toInt(), R.drawable.widget_course_green),  // green
            Palette(0xFFE0913C.toInt(), R.drawable.widget_course_orange), // orange
            Palette(0xFF9B6FD4.toInt(), R.drawable.widget_course_purple), // purple
            Palette(0xFFD96A9C.toInt(), R.drawable.widget_course_pink),   // pink
            Palette(0xFF42AFA5.toInt(), R.drawable.widget_course_teal),   // teal
            Palette(0xFFC9A227.toInt(), R.drawable.widget_course_gold),   // gold
            Palette(0xFF6C7BD9.toInt(), R.drawable.widget_course_indigo), // indigo
        )

        /** 与 App 完全一致的课程名 hash 取色（hash*31+charCode 无符号 32 位取模 8） */
        private fun courseHueIndex(name: String): Int {
            var hash = 0
            for (ch in name) {
                hash = (hash * 31 + ch.code) and 0xFFFFFFFF.toInt()
            }
            return Math.floorMod(hash, COURSE_PALETTE.size)
        }
    }

    private data class WidgetData(
        val week: Int,
        /** 显示用课程（已过滤“已下课”） */
        val courses: List<Map<String, String>>,
        /** 今天全部课程（用于计算下课刷新时刻） */
        val allToday: List<Map<String, String>>,
        val periodTimes: Map<Int, String>,
        val periodDurations: Map<Int, Int>,
    )
    private data class Palette(val color: Int, val bgRes: Int)

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_REFRESH) {
            // 下课时刻自动刷新：直接重渲染该 widget，避免走 super 的默认分发
            val appWidgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1)
            if (appWidgetId >= 0) {
                updateWidget(context, AppWidgetManager.getInstance(context), appWidgetId)
            }
            return
        }
        super.onReceive(context, intent)
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId)
        }
    }

    private fun updateWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
        val prefs = context.getSharedPreferences(prefsName(context.packageName), Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_DATA, null)
        val widgetData = if (raw.isNullOrBlank()) {
            WidgetData(1, emptyList(), emptyList(), emptyMap(), emptyMap())
        } else {
            parseData(raw)
        }

        // 读取小组件当前尺寸（dp），做响应式布局
        // 注意：桌面可能尚未上报尺寸（options 为空 Bundle），此时不能按 130dp 的
        // 紧凑默认渲染成“1 门课”，否则刚添加的小组件会显得像旧版；默认按 260dp
        // 竖排 3 门课处理（周六 2 门课即两行铺满）。
        val options = appWidgetManager.getAppWidgetOptions(appWidgetId)
        val width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 260)
        val height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 260)
        // 宽而矮（超宽横条，如 5×2）时切换横排；普通竖条（如 3×2、3×3、2×2）
        // 一律竖排，两门课即两行铺满——收紧触发条件，避免 3×2 被误判成横排，
        // 让课卡变成两列窄条而破坏“两行铺满”效果。
        val wide = width >= height * 2.5f && height < 200
        // 高度格子数 = 显示课程数上限：2 格至多 2 节、3 格至多 3 节、4~6 格对应 4~6 节，
        // 封顶 6 节（竖排与横排一致）
        val heightCells = (height / CELL_HEIGHT_DP).roundToInt().coerceIn(1, 6)
        val courses = widgetData.courses

        // 单科（且非横排）时切换固定高度布局：卡片 56dp 固定、下方留白，
        // 避免 weight 撑满整高导致卡片过肥。该布局只有头部 + 单卡 id。
        val useSingleLayout = courses.size == 1 && !wide
        val views = RemoteViews(
            context.packageName,
            if (useSingleLayout) R.layout.widget_timetable_single else R.layout.widget_timetable
        )

        Log.d(
            "TimetableWidget",
            "id=$appWidgetId w=${width} h=${height} cells=$heightCells wide=$wide courses=${courses.size} week=${widgetData.week} single=$useSingleLayout"
        )

        // 头部：周次徽标 + 日期；过矮时隐藏日期行（标题上移、留更多空间给课程）
        views.setTextViewText(R.id.header_week_badge, "第${widgetData.week}周")
        views.setTextViewText(R.id.header_date, buildDateText())
        if (height < 140) {
            views.setViewVisibility(R.id.header_date, View.GONE)
        }

        when {
            courses.isEmpty() -> {
                setGone(views, V_CONTAINERS)
                setGone(views, H_CONTAINERS)
                views.setViewVisibility(R.id.hcourse_row, View.GONE)
                views.setViewVisibility(R.id.empty_container, View.VISIBLE)
            }
            useSingleLayout -> {
                // 单科固定高度布局：只设置该布局存在的 id
                val palette = COURSE_PALETTE[courseHueIndex(courses[0]["name"] ?: "")]
                views.setInt(R.id.course1_container, "setBackgroundResource", palette.bgRes)
                views.setInt(R.id.course1_accent, "setBackgroundColor", palette.color)
                views.setTextViewText(R.id.course1_name, courses[0]["name"] ?: "")
                views.setTextViewText(R.id.course1_meta, buildMeta(courses[0]))
            }
            wide -> {
                views.setViewVisibility(R.id.hcourse_row, View.VISIBLE)
                views.setViewVisibility(R.id.empty_container, View.GONE)
                setGone(views, V_CONTAINERS)
                // 横排列数同样受高度格子数限制（2 格至多 2 列）
                for (i in 0 until 6) {
                    if (i < courses.size && i < heightCells) {
                        val palette = COURSE_PALETTE[courseHueIndex(courses[i]["name"] ?: "")]
                        views.setViewVisibility(H_CONTAINERS[i], View.VISIBLE)
                        views.setInt(H_CONTAINERS[i], "setBackgroundResource", palette.bgRes)
                        views.setTextViewText(H_NAMES[i], courses[i]["name"] ?: "")
                        views.setTextViewText(H_METAS[i], buildMeta(courses[i]))
                    } else {
                        views.setViewVisibility(H_CONTAINERS[i], View.GONE)
                    }
                }
            }
            else -> {
                views.setViewVisibility(R.id.hcourse_row, View.GONE)
                views.setViewVisibility(R.id.empty_container, View.GONE)
                // 卡片用 weight 平分高度铺满；显示上限 = 高度格子数（2 格至多 2 节、3 格至多 3 节）
                val maxCount = heightCells
                for (i in 0 until 6) {
                    if (i < courses.size && i < maxCount) {
                        val palette = COURSE_PALETTE[courseHueIndex(courses[i]["name"] ?: "")]
                        views.setViewVisibility(V_CONTAINERS[i], View.VISIBLE)
                        views.setInt(V_CONTAINERS[i], "setBackgroundResource", palette.bgRes)
                        views.setInt(V_ACCENTS[i], "setBackgroundColor", palette.color)
                        views.setTextViewText(V_NAMES[i], courses[i]["name"] ?: "")
                        views.setTextViewText(V_METAS[i], buildMeta(courses[i]))
                    } else {
                        views.setViewVisibility(V_CONTAINERS[i], View.GONE)
                    }
                }
            }
        }

        val clickIntent = Intent(Intent.ACTION_VIEW).apply {
            data = Uri.parse("$SCHEME://widget")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            0,
            clickIntent,
            PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.widget_root, pendingIntent)

        appWidgetManager.updateAppWidget(appWidgetId, views)

        // 下课时刻自动刷新：安排到下一个下课时间点，到点重渲染（已下课课程消失）
        scheduleNextRefresh(context, appWidgetId, widgetData)
    }

    private fun setGone(views: RemoteViews, ids: IntArray) {
        for (id in ids) views.setViewVisibility(id, View.GONE)
    }

    /** 课程补充信息：时间 + 地点，用“·”连接，空字段自动省略。 */
    private fun buildMeta(course: Map<String, String>): String {
        val parts = mutableListOf<String>()
        val time = course["time"]
        val location = course["location"]
        if (!time.isNullOrEmpty()) parts.add(time)
        if (!location.isNullOrEmpty()) parts.add(location)
        return parts.joinToString(" · ")
    }

    /** 解析 payload，按“当前周 + 当天星期”过滤，并做“下课过滤”。 */
    private fun parseData(raw: String): WidgetData {
        return try {
            val root = JSONObject(raw)
            val storedWeek = root.optInt("currentWeek", 1)
            val semesterStart = root.optString("semesterStartDate", "")
            val currentWeek = if (semesterStart.isNotBlank()) computeCurrentWeek(semesterStart) else storedWeek
            val todayKey = DAY_KEYS[dayOfWeekIndex()]

            val periodTimes = parsePeriodTimes(root.optJSONObject("periodTimes"))
            val periodDurations = parsePeriodDurations(root.optJSONObject("periodDurations"))

            val jsonArray = root.optJSONArray("courses") ?: JSONArray()
            val allToday = mutableListOf<Map<String, String>>()
            for (i in 0 until jsonArray.length()) {
                val obj = jsonArray.getJSONObject(i)
                if (!inWeek(obj, currentWeek)) continue
                if (obj.optString("day", "") != todayKey) continue
                val name = obj.optString("name", "")
                val locationObj = obj.optJSONObject("location")
                val address = locationObj?.optString("address", "") ?: ""
                val time = buildTimeString(obj)
                allToday.add(mapOf(
                    "name" to name,
                    "location" to address,
                    "time" to time,
                    "endPeriod" to obj.optInt("endPeriod", 0).toString()
                ))
            }

            // 下课过滤：结束时间已过的课程不再显示（进行中/未开始的保留）
            val nowMs = System.currentTimeMillis()
            val visible = allToday.filter { course ->
                val endMs = courseEndMillis(course, periodTimes, periodDurations)
                endMs == null || endMs > nowMs
            }

            WidgetData(currentWeek, visible, allToday, periodTimes, periodDurations)
        } catch (e: Exception) {
            WidgetData(1, emptyList(), emptyList(), emptyMap(), emptyMap())
        }
    }

    private fun parsePeriodTimes(obj: JSONObject?): Map<Int, String> {
        val map = mutableMapOf<Int, String>()
        if (obj != null) {
            val it = obj.keys()
            while (it.hasNext()) {
                val key = it.next()
                val period = key.toIntOrNull()
                val value = obj.optString(key, "")
                if (period != null && value.isNotBlank()) map[period] = value
            }
        }
        return map
    }

    private fun parsePeriodDurations(obj: JSONObject?): Map<Int, Int> {
        val map = mutableMapOf<Int, Int>()
        if (obj != null) {
            val it = obj.keys()
            while (it.hasNext()) {
                val key = it.next()
                val period = key.toIntOrNull()
                if (period != null) map[period] = obj.optInt(key, DEFAULT_PERIOD_MINUTES)
            }
        }
        return map
    }

    /** 课程下课时刻（毫秒时间戳）；缺节次时间/无法计算时返回 null。 */
    private fun courseEndMillis(
        course: Map<String, String>,
        periodTimes: Map<Int, String>,
        periodDurations: Map<Int, Int>
    ): Long? {
        val endPeriod = course["endPeriod"]?.toIntOrNull() ?: return null
        val startTime = periodTimes[endPeriod] ?: defaultPeriodStart(endPeriod) ?: return null
        val parts = startTime.split(":")
        if (parts.size != 2) return null
        val hour = parts[0].toIntOrNull() ?: return null
        val minute = parts[1].toIntOrNull() ?: return null
        val duration = periodDurations[endPeriod] ?: DEFAULT_PERIOD_MINUTES
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        return cal.timeInMillis + duration * 60_000L
    }

    /** 默认节次开始时间 "HH:MM"（第 N 节 = 08:00 + (N-1)*50min）；超出 24 小时返回 null。 */
    private fun defaultPeriodStart(period: Int): String? {
        val total = FIRST_PERIOD_MINUTES + (period - 1) * PERIOD_STEP_MINUTES
        if (total >= 24 * 60) return null
        val h = total / 60
        val m = total % 60
        return "${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}"
    }

    /**
     * 安排下一次下课时刻的自动刷新。
     * 用 setAndAllowWhileIdle（非精确闹钟，无需额外权限）；每次 onUpdate 都会
     * 用相同 PendingIntent 重新设置，天然替换旧闹钟。无课程或无法计算下课时间
     * 时不设置（由 updatePeriodMillis 30 分钟兜底，次日课程照常显示）。
     */
    private fun scheduleNextRefresh(context: Context, appWidgetId: Int, widgetData: WidgetData) {
        if (widgetData.allToday.isEmpty()) return
        val nowMs = System.currentTimeMillis()
        var nextMs: Long? = null
        for (course in widgetData.allToday) {
            val endMs = courseEndMillis(course, widgetData.periodTimes, widgetData.periodDurations) ?: continue
            if (endMs > nowMs && (nextMs == null || endMs < nextMs)) nextMs = endMs
        }
        val triggerAt = nextMs ?: return
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(context, TimetableWidgetProvider::class.java).apply {
            action = ACTION_REFRESH
            data = Uri.parse("$SCHEME://refresh/$appWidgetId")
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context, appWidgetId, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
        Log.d("TimetableWidget", "id=$appWidgetId nextRefreshAt=${triggerAt}")
    }

    private fun inWeek(obj: JSONObject, currentWeek: Int): Boolean {
        val weekList = obj.optJSONArray("weekList") ?: return false
        for (j in 0 until weekList.length()) {
            if (weekList.getInt(j) == currentWeek) return true
        }
        return false
    }

    private fun buildTimeString(obj: JSONObject): String {
        val start = obj.optInt("startPeriod", 0)
        val end = obj.optInt("endPeriod", 0)
        val slot = obj.optString("timeSlot", "")
        return when {
            start > 0 && end > 0 -> "第 $start-$end 节"
            slot.isNotEmpty() -> slot
            else -> ""
        }
    }

    /** 头部日期文案，如“周一 9月12日”。 */
    private fun buildDateText(): String {
        val cal = Calendar.getInstance()
        val weekday = WEEKDAY_CN[cal.get(Calendar.DAY_OF_WEEK) - 1]
        val month = cal.get(Calendar.MONTH) + 1
        val day = cal.get(Calendar.DAY_OF_MONTH)
        return "$weekday ${month}月${day}日"
    }

    /** 1=周日 … 7=周六 → DAY_KEYS 下标。 */
    private fun dayOfWeekIndex(): Int {
        return Calendar.getInstance().get(Calendar.DAY_OF_WEEK) - 1
    }

    /** 按学期开始日期计算当前周（与 JS 侧逻辑一致：整周向上取整，不足 1 周按 1）。 */
    private fun computeCurrentWeek(semesterStartDate: String): Int {
        return try {
            val parts = semesterStartDate.split("-")
            if (parts.size != 3) return 1
            val startCal = Calendar.getInstance().apply {
                set(Calendar.YEAR, parts[0].toInt())
                set(Calendar.MONTH, parts[1].toInt() - 1)
                set(Calendar.DAY_OF_MONTH, parts[2].toInt())
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
            val todayStart = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }.timeInMillis
            val diffMs = todayStart - startCal.timeInMillis
            if (diffMs < 0) {
                1
            } else {
                val dayMs = 1000.0 * 60 * 60 * 24
                Math.max(1, Math.ceil((diffMs + dayMs) / (dayMs * 7)).toInt())
            }
        } catch (e: Exception) {
            1
        }
    }
}
