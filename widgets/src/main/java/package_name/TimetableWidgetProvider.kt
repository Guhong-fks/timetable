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
 * 璇捐〃妗岄潰灏忕粍浠?Provider銆? *
 * 鏁版嵁婧愶細App锛圝S 渚э級閫氳繃 @bittingz/expo-widgets 鐨?setWidgetData() 鍐欏叆
 * SharedPreferences锛堝悕绉?= <applicationId>.widgetdata锛宬ey = widgetdata锛夛紝
 * payload 缁撴瀯锛? *   {
 *     "currentWeek": int,
 *     "semesterStartDate": "yyyy-MM-dd"|"",
 *     "courses": [WidgetCourseData...],
 *     "periodTimes": {"1":"08:00",...},       // 鑺傛寮€濮嬫椂闂达紙鐢ㄦ埛鍙湪 App 閰嶇疆锛? *     "periodDurations": {"1":45,...}         // 鑺傛鏃堕暱锛堝垎閽燂級
 *   }
 *
 * 姣忔 onUpdate锛堢郴缁熷畾鏃?updatePeriodMillis / App 鍐欏叆鏁版嵁鍚庡簱鑷姩骞挎挱 /
 * 涓嬭鏃跺埢 AlarmManager 鑷姩鍒锋柊锛夋椂锛? *   1. 鏈?semesterStartDate 鍒欓噸绠楀綋鍓嶅懆锛堥伩鍏?App 闀挎湡鏈墦寮€瀵艰嚧鍛ㄦ杩囨湡锛夛紱
 *   2. 鎸夆€滃綋鍓嶅懆 + 褰撳ぉ鏄熸湡鈥濊繃婊よ绋嬶紱
 *   3. 鈥滀笅璇捐繃婊も€濓細缁撴潫鏃堕棿宸茶繃鐨勮绋嬩笉鍐嶆樉绀猴紙杩涜涓?鏈紑濮嬩繚鐣欙級锛? *   4. 璇诲彇灏忕粍浠跺疄闄呭昂瀵稿仛鍝嶅簲寮忔覆鏌擄紙绔栨帓/妯帓銆?~3 闂ㄨ銆佸懆娆?鏃ユ湡澶撮儴锛夛紱
 *   5. 鐢?AlarmManager 鍦ㄤ笅涓€涓笅璇炬椂鍒诲畨鎺掕嚜鍔ㄥ埛鏂帮紝瀹炵幇鈥滀笅璇惧嵆娑堝け鈥濓紱
 *   6. 鐐瑰嚮璺冲洖 App锛坈oursetableapp://widget锛夈€? *
 * 璇存槑锛氫笉鍐嶄娇鐢ㄨ嚜瀹氫箟闂归挓鍋氬懆鏈熷埛鏂帮紝缁熶竴渚濊禆 widget_timetable_info.xml 鐨? * updatePeriodMillis 绯荤粺绾у厹搴?+ App 鍐欏叆鏃跺嵆鏃跺埛鏂?+ 涓嬭鏃跺埢绮剧‘鍒锋柊銆? */
class TimetableWidgetProvider : AppWidgetProvider() {

    companion object {
        /** 搴?setWidgetData 鍐欏叆鐨?SharedPreferences 鍚?= packageName + ".widgetdata" */
        private fun prefsName(packageName: String) = "$packageName.widgetdata"
        private const val KEY_DATA = "widgetdata"
        private const val SCHEME = "coursetableapp"

        /** 涓嬭鑷姩鍒锋柊骞挎挱 action */
        private const val ACTION_REFRESH = "com.fksguh.coursetableapp.action.WIDGET_REFRESH"

        /** 榛樿鑺傛鏃堕棿瑙勫垯锛堜笌 App 渚?createDefaultPeriodTimes 涓€鑷达級锛氱 N 鑺?= 08:00 + (N-1)*50min锛屾瘡鑺?45 鍒嗛挓 */
        private const val FIRST_PERIOD_MINUTES = 8 * 60
        private const val PERIOD_STEP_MINUTES = 50
        private const val DEFAULT_PERIOD_MINUTES = 45

        /**
         * 妗岄潰缃戞牸鍗曞厓楂樺害锛坉p/鏍硷級銆傜敱瀹炴祴鎺ㄧ畻锛?脳2 灏忕粍浠?options 楂樺害 鈮?183dp
         * 锛? 鏍硷級鈫?绾?91.5dp/鏍笺€傝绋嬫樉绀轰笂闄愭寜鈥滈珮搴︽牸瀛愭暟鈥濆喅瀹氾細
         * 2 鏍艰嚦澶?2 鑺傘€? 鏍艰嚦澶?3 鑺傦紙妯帓鍚屾牱鍙楁闄愬埗锛夈€?         */
        private const val CELL_HEIGHT_DP = 75f

        private val DAY_KEYS = arrayOf(
            "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
        )
        private val WEEKDAY_CN = arrayOf("鍛ㄦ棩", "鍛ㄤ竴", "鍛ㄤ簩", "鍛ㄤ笁", "鍛ㄥ洓", "鍛ㄤ簲", "鍛ㄥ叚")

        /** 绔栨帓鍗＄墖瑙嗗浘缁勶紙瀹瑰櫒 / 宸︿晶鑹叉潯 / 璇剧▼鍚?/ 琛ュ厖淇℃伅锛夛紝鏈€澶?6 闂ㄨ */
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

        /** 妯帓鍗＄墖瑙嗗浘缁勶紙瀹藉睆妯″紡锛夛紝鏈€澶?6 鍒?*/
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
         * 璇惧崱鑹叉澘锛氫笌 App 璇剧▼琛紙src/app/(tabs)/index.tsx COURSE_PALETTE锛夊畬鍏ㄤ竴鑷达紝
         * 鎸夎绋嬪悕 hash 鍙栬壊锛屼繚璇佸悓涓€闂ㄨ鍦ㄥ皬缁勪欢鍜?App 閲岄鑹茬浉鍚屻€?         * color 涓哄疄鑹诧紙鐢ㄤ簬宸︿晶鑹叉潯锛夛紝bgRes 涓鸿鑹?14% 閫忔槑搴︾殑鍦嗚鍗¤儗鏅€?         */
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

        /** 涓?App 瀹屽叏涓€鑷寸殑璇剧▼鍚?hash 鍙栬壊锛坔ash*31+charCode 鏃犵鍙?32 浣嶅彇妯?8锛?*/
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
        /** 鏄剧ず鐢ㄨ绋嬶紙宸茶繃婊も€滃凡涓嬭鈥濓級 */
        val courses: List<Map<String, String>>,
        /** 浠婂ぉ鍏ㄩ儴璇剧▼锛堢敤浜庤绠椾笅璇惧埛鏂版椂鍒伙級 */
        val allToday: List<Map<String, String>>,
        val periodTimes: Map<Int, String>,
        val periodDurations: Map<Int, Int>,
    )
    private data class Palette(val color: Int, val bgRes: Int)

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_REFRESH) {
            // 涓嬭鏃跺埢鑷姩鍒锋柊锛氱洿鎺ラ噸娓叉煋璇?widget锛岄伩鍏嶈蛋 super 鐨勯粯璁ゅ垎鍙?            val appWidgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1)
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

    /**
     * 灏哄鍙樺寲鍥炶皟锛氱敤鎴锋嫋鍔?resize 灏忕粍浠舵椂锛孡auncher 璋冪敤
     * AppWidgetManager.updateAppWidgetOptions 骞惰Е鍙戞湰鍥炶皟銆?     * 娉ㄦ剰锛欰ppWidgetProvider 鐨勯粯璁ゅ疄鐜版槸绌虹殑锛屼笉浼氳嚜鍔ㄩ噸鏂版覆鏌擄紝
     * 蹇呴』鍦ㄨ繖閲岀敤鏈€鏂?options锛坓etAppWidgetOptions 宸叉洿鏂帮級閲嶇敾锛?     * 鍚﹀垯妗岄潰浼氱户缁媺浼告棫甯冨眬锛堣〃鐜颁负"璇剧▼楂樺害琚媺楂樸€佽绋嬫暟涓嶅彉"锛夈€?     */
    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: android.os.Bundle?
    ) {
        val w = newOptions?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, -1)
        val h = newOptions?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, -1)
        Log.d("TimetableWidget", "id=$appWidgetId optionsChanged w=${w} h=${h}")
        updateWidget(context, appWidgetManager, appWidgetId)
    }

    private fun updateWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
        val prefs = context.getSharedPreferences(prefsName(context.packageName), Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_DATA, null)
        val widgetData = if (raw.isNullOrBlank()) {
            WidgetData(1, emptyList(), emptyList(), emptyMap(), emptyMap())
        } else {
            parseData(raw)
        }

        // 璇诲彇灏忕粍浠跺綋鍓嶅昂瀵革紙dp锛夛紝鍋氬搷搴斿紡甯冨眬
        // 娉ㄦ剰锛氭闈㈠彲鑳藉皻鏈笂鎶ュ昂瀵革紙options 涓虹┖ Bundle锛夛紝姝ゆ椂涓嶈兘鎸?130dp 鐨?        // 绱у噾榛樿娓叉煋鎴愨€? 闂ㄨ鈥濓紝鍚﹀垯鍒氭坊鍔犵殑灏忕粍浠朵細鏄惧緱鍍忔棫鐗堬紱榛樿鎸?260dp
        // 绔栨帓 3 闂ㄨ澶勭悊锛堝懆鍏?2 闂ㄨ鍗充袱琛岄摵婊★級銆?        val options = appWidgetManager.getAppWidgetOptions(appWidgetId)
        val width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 260)
        val height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 260)
        // 瀹借€岀煯锛堣秴瀹芥í鏉★紝濡?5脳2锛夋椂鍒囨崲妯帓锛涙櫘閫氱珫鏉★紙濡?3脳2銆?脳3銆?脳2锛?        // 涓€寰嬬珫鎺掞紝涓ら棬璇惧嵆涓よ閾烘弧鈥斺€旀敹绱цЕ鍙戞潯浠讹紝閬垮厤 3脳2 琚鍒ゆ垚妯帓锛?        // 璁╄鍗″彉鎴愪袱鍒楃獎鏉¤€岀牬鍧忊€滀袱琛岄摵婊♀€濇晥鏋溿€?        val wide = width >= height * 2.5f && height < 200
        // 楂樺害鏍煎瓙鏁?= 鏄剧ず璇剧▼鏁颁笂闄愶細2 鏍艰嚦澶?2 鑺傘€? 鏍艰嚦澶?3 鑺傘€?~6 鏍煎搴?4~6 鑺傦紝
        // 灏侀《 6 鑺傦紙绔栨帓涓庢í鎺掍竴鑷达級
        val heightCells = (height / CELL_HEIGHT_DP).roundToInt().coerceIn(1, 6)
        val courses = widgetData.courses

        // 鍗曠锛堜笖闈炴í鎺掞級鏃跺垏鎹㈠浐瀹氶珮搴﹀竷灞€锛氬崱鐗?56dp 鍥哄畾銆佷笅鏂圭暀鐧斤紝
        // 閬垮厤 weight 鎾戞弧鏁撮珮瀵艰嚧鍗＄墖杩囪偉銆傝甯冨眬鍙湁澶撮儴 + 鍗曞崱 id銆?        val useSingleLayout = courses.size == 1 && !wide
        val views = RemoteViews(
            context.packageName,
            if (useSingleLayout) R.layout.widget_timetable_single else R.layout.widget_timetable
        )

        Log.d(
            "TimetableWidget",
            "id=$appWidgetId w=${width} h=${height} cells=$heightCells wide=$wide courses=${courses.size} week=${widgetData.week} single=$useSingleLayout"
        )

        // 澶撮儴锛氬懆娆″窘鏍?+ 鏃ユ湡锛涜繃鐭椂闅愯棌鏃ユ湡琛岋紙鏍囬涓婄Щ銆佺暀鏇村绌洪棿缁欒绋嬶級
        views.setTextViewText(R.id.header_week_badge, "绗?{widgetData.week}鍛?)
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
                // 鍗曠鍥哄畾楂樺害甯冨眬锛氬彧璁剧疆璇ュ竷灞€瀛樺湪鐨?id
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
                // 妯帓鍒楁暟鍚屾牱鍙楅珮搴︽牸瀛愭暟闄愬埗锛? 鏍艰嚦澶?2 鍒楋級
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
                // 鍗＄墖鐢?weight 骞冲垎楂樺害閾烘弧锛涙樉绀轰笂闄?= 楂樺害鏍煎瓙鏁帮紙2 鏍艰嚦澶?2 鑺傘€? 鏍艰嚦澶?3 鑺傦級
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

        // 涓嬭鏃跺埢鑷姩鍒锋柊锛氬畨鎺掑埌涓嬩竴涓笅璇炬椂闂寸偣锛屽埌鐐归噸娓叉煋锛堝凡涓嬭璇剧▼娑堝け锛?        scheduleNextRefresh(context, appWidgetId, widgetData)
    }

    private fun setGone(views: RemoteViews, ids: IntArray) {
        for (id in ids) views.setViewVisibility(id, View.GONE)
    }

    /** 璇剧▼琛ュ厖淇℃伅锛氭椂闂?+ 鍦扮偣锛岀敤鈥溌封€濊繛鎺ワ紝绌哄瓧娈佃嚜鍔ㄧ渷鐣ャ€?*/
    private fun buildMeta(course: Map<String, String>): String {
        val parts = mutableListOf<String>()
        val time = course["time"]
        val location = course["location"]
        if (!time.isNullOrEmpty()) parts.add(time)
        if (!location.isNullOrEmpty()) parts.add(location)
        return parts.joinToString(" 路 ")
    }

    /** 瑙ｆ瀽 payload锛屾寜鈥滃綋鍓嶅懆 + 褰撳ぉ鏄熸湡鈥濊繃婊わ紝骞跺仛鈥滀笅璇捐繃婊も€濄€?*/
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

            // 涓嬭杩囨护锛氱粨鏉熸椂闂村凡杩囩殑璇剧▼涓嶅啀鏄剧ず锛堣繘琛屼腑/鏈紑濮嬬殑淇濈暀锛?            val nowMs = System.currentTimeMillis()
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

    /** 璇剧▼涓嬭鏃跺埢锛堟绉掓椂闂存埑锛夛紱缂鸿妭娆℃椂闂?鏃犳硶璁＄畻鏃惰繑鍥?null銆?*/
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

    /** 榛樿鑺傛寮€濮嬫椂闂?"HH:MM"锛堢 N 鑺?= 08:00 + (N-1)*50min锛夛紱瓒呭嚭 24 灏忔椂杩斿洖 null銆?*/
    private fun defaultPeriodStart(period: Int): String? {
        val total = FIRST_PERIOD_MINUTES + (period - 1) * PERIOD_STEP_MINUTES
        if (total >= 24 * 60) return null
        val h = total / 60
        val m = total % 60
        return "${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}"
    }

    /**
     * 瀹夋帓涓嬩竴娆′笅璇炬椂鍒荤殑鑷姩鍒锋柊銆?     * 鐢?setAndAllowWhileIdle锛堥潪绮剧‘闂归挓锛屾棤闇€棰濆鏉冮檺锛夛紱姣忔 onUpdate 閮戒細
     * 鐢ㄧ浉鍚?PendingIntent 閲嶆柊璁剧疆锛屽ぉ鐒舵浛鎹㈡棫闂归挓銆傛棤璇剧▼鎴栨棤娉曡绠椾笅璇炬椂闂?     * 鏃朵笉璁剧疆锛堢敱 updatePeriodMillis 30 鍒嗛挓鍏滃簳锛屾鏃ヨ绋嬬収甯告樉绀猴級銆?     */
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
            start > 0 && end > 0 -> "绗?$start-$end 鑺?
            slot.isNotEmpty() -> slot
            else -> ""
        }
    }

    /** 澶撮儴鏃ユ湡鏂囨锛屽鈥滃懆涓€ 9鏈?2鏃モ€濄€?*/
    private fun buildDateText(): String {
        val cal = Calendar.getInstance()
        val weekday = WEEKDAY_CN[cal.get(Calendar.DAY_OF_WEEK) - 1]
        val month = cal.get(Calendar.MONTH) + 1
        val day = cal.get(Calendar.DAY_OF_MONTH)
        return "$weekday ${month}鏈?{day}鏃?
    }

    /** 1=鍛ㄦ棩 鈥?7=鍛ㄥ叚 鈫?DAY_KEYS 涓嬫爣銆?*/
    private fun dayOfWeekIndex(): Int {
        return Calendar.getInstance().get(Calendar.DAY_OF_WEEK) - 1
    }

    /** 鎸夊鏈熷紑濮嬫棩鏈熻绠楀綋鍓嶅懆锛堜笌 JS 渚ч€昏緫涓€鑷达細鏁村懆鍚戜笂鍙栨暣锛屼笉瓒?1 鍛ㄦ寜 1锛夈€?*/
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
