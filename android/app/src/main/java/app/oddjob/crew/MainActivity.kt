package app.oddjob.crew

import app.oddjob.crew.ui.rooms.roomOrgIdFromPath
import app.oddjob.crew.ui.cards.MapLocationPrefs
import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalUriHandler
import app.oddjob.crew.push.PushRegistrar
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import app.oddjob.crew.ui.approvals.ApprovalsScreen
import app.oddjob.crew.ui.approvals.ApprovalsViewModel
import app.oddjob.crew.ui.computeruse.ComputerUseTaskScreen
import app.oddjob.crew.ui.computeruse.ComputerUseTaskViewModel
import app.oddjob.crew.ui.login.LoginScreen
import app.oddjob.crew.ui.login.LoginViewModel
import app.oddjob.crew.ui.room.RoomScreen
import app.oddjob.crew.ui.room.RoomViewModel
import app.oddjob.crew.ui.rooms.RoomsScreen
import app.oddjob.crew.ui.rooms.RoomsViewModel
import app.oddjob.crew.ui.settings.SettingsScreen
import app.oddjob.crew.ui.settings.SettingsViewModel
import app.oddjob.crew.ui.theme.CrewTheme

class MainActivity : ComponentActivity() {
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleNotificationTap(intent)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Light glyphs on the dark theme's bars, whatever the system setting.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        val app = application as CrewApplication
        handleNotificationTap(intent)
        setContent {
            CrewTheme { CrewNavHost(app) }
        }
    }
}

/** A path a notification carries, e.g. /workspace/chat/<key>; queued until the rooms screen can open it. */
private fun ComponentActivity.handleNotificationTap(intent: Intent?) {
    val url = intent?.getStringExtra(PushRegistrar.EXTRA_URL) ?: return
    (application as CrewApplication).pendingDeepLink.value = url
    intent.removeExtra(PushRegistrar.EXTRA_URL)
}

/** A computer-use task a pause push points at: /workspace/computer-use?session=…&task=…[&orgId=…]. */
internal data class ComputerUseLink(val taskId: String, val orgId: Int?)

private fun pathOnly(path: String) = path.substringBefore('?').substringBefore('#').trimEnd('/')

private fun queryParams(path: String): Map<String, String> =
    path.substringAfter('?', "").substringBefore('#').split('&').mapNotNull { pair ->
        val name = pair.substringBefore('=')
        val value = pair.substringAfter('=', "")
        // java.net, not android.net.Uri: this runs in plain JVM tests.
        if (name.isEmpty()) null else name to java.net.URLDecoder.decode(value, "UTF-8")
    }.toMap()

internal fun computerUseLinkFromPath(path: String): ComputerUseLink? {
    if (pathOnly(path) != "/workspace/computer-use") return null
    val params = queryParams(path)
    val taskId = params["task"]?.takeIf { it.isNotBlank() } ?: return null
    return ComputerUseLink(taskId, params["orgId"]?.toIntOrNull())
}

/** An approval push: /assistant/workbench[?approval=<id>]. [focusId] is the approval to show first. */
internal data class ApprovalsLink(val focusId: Int?)

internal fun approvalsLinkFromPath(path: String): ApprovalsLink? {
    if (pathOnly(path) != "/assistant/workbench") return null
    return ApprovalsLink(queryParams(path)["approval"]?.toIntOrNull())
}

/** The Gmail alert a directive push opens a room for: /workspace/chat/<key>?gmailAlert=<eventId>. */
internal fun gmailAlertFromPath(path: String): Int? =
    if (roomKeyFromPath(path) == null) null else queryParams(path)["gmailAlert"]?.toIntOrNull()?.takeIf { it > 0 }

/** The room key in a /workspace/chat/<key> path, or null for any other path. */
internal fun roomKeyFromPath(path: String): String? {
    val marker = "/workspace/chat/"
    if (!path.startsWith(marker)) return null
    return path.removePrefix(marker).substringBefore('?').substringBefore('#').trimEnd('/').ifEmpty { null }
}

private object Routes {
    const val LOGIN = "login"
    const val ROOMS = "rooms"
    const val ROOM = "room/{key}?gmailAlert={gmailAlert}&orgId={orgId}"
    const val SETTINGS = "settings"
    const val TASK = "computer-use/{taskId}?orgId={orgId}"
    const val APPROVALS = "approvals?focus={focus}"
    fun approvals(focusId: Int? = null) = "approvals?focus=${focusId ?: ""}"
    fun room(key: String, gmailAlert: Int? = null, orgId: Int? = null) =
        "room/${Uri.encode(key)}?gmailAlert=${gmailAlert ?: ""}&orgId=${orgId ?: ""}"
    fun task(link: ComputerUseLink) = "computer-use/${Uri.encode(link.taskId)}?orgId=${link.orgId ?: ""}"
}

@Composable
private fun CrewNavHost(app: CrewApplication) {
    val nav = rememberNavController()

    // A tapped notification opens from any signed-in screen, not only Rooms: a
    // push that lands while a room is open must not wait for the back button.
    val link by app.pendingDeepLink.collectAsStateWithLifecycle()
    val current by nav.currentBackStackEntryAsState()
    val uriHandler = LocalUriHandler.current
    LaunchedEffect(link, current?.destination?.route) {
        val url = link ?: return@LaunchedEffect
        val route = current?.destination?.route ?: return@LaunchedEffect
        if (route == Routes.LOGIN) return@LaunchedEffect // opened once signed in
        app.pendingDeepLink.value = null
        val key = roomKeyFromPath(url)
        val task = computerUseLinkFromPath(url)
        val approvals = approvalsLinkFromPath(url)
        when {
            key != null -> nav.navigate(Routes.room(key, gmailAlertFromPath(url), roomOrgIdFromPath(url)))
            task != null -> nav.navigate(Routes.task(task))
            approvals != null -> nav.navigate(Routes.approvals(approvals.focusId))
            else -> uriHandler.openUri(app.session.serverUrl.orEmpty().trimEnd('/') + url)
        }
    }

    NavHost(navController = nav, startDestination = Routes.LOGIN) {
        composable(Routes.LOGIN) {
            val vm: LoginViewModel = viewModel(factory = viewModelFactory {
                initializer { LoginViewModel(app.api, app.session) }
            })
            val state by vm.state.collectAsStateWithLifecycle()
            LaunchedEffect(state.signedIn) {
                if (state.signedIn) nav.navigate(Routes.ROOMS) { popUpTo(Routes.LOGIN) { inclusive = true } }
            }
            LoginScreen(vm, state)
        }

        composable(Routes.ROOMS) {
            val vm: RoomsViewModel = viewModel(factory = viewModelFactory {
                initializer { RoomsViewModel(app.api, app.roomCache) }
            })
            val state by vm.state.collectAsStateWithLifecycle()
            LaunchedEffect(state.signedOut) { if (state.signedOut) nav.toLogin() }
            // Signed in from here on: register this phone for push and ask for
            // the notification permission once.
            LaunchedEffect(Unit) { app.registerPush() }
            NotificationPermissionPrompt(app) { app.registerPush() }
            RoomsScreen(
                vm,
                state,
                onOpenRoom = { key, orgId -> nav.navigate(Routes.room(key, orgId = orgId)) },
                onOpenSettings = { nav.navigate(Routes.SETTINGS) },
                onOpenApprovals = { nav.navigate(Routes.approvals()) },
            )
        }

        composable(Routes.SETTINGS) {
            val vm: SettingsViewModel = viewModel(factory = viewModelFactory {
                initializer { SettingsViewModel(app.api, app.session, onSignOut = app::signOut) }
            })
            val state by vm.state.collectAsStateWithLifecycle()
            LaunchedEffect(state.signedOut) { if (state.signedOut) nav.toLogin() }
            val pushStatus by app.pushStatus.collectAsStateWithLifecycle()
            SettingsScreen(vm, state, pushStatus = pushStatus, onBack = { nav.popBackStack() })
        }

        composable(
            Routes.APPROVALS,
            arguments = listOf(navArgument("focus") { type = NavType.StringType; nullable = true; defaultValue = null }),
        ) { entry ->
            val focus = entry.arguments?.getString("focus")?.toIntOrNull()
            val vm: ApprovalsViewModel = viewModel(key = "approvals:$focus", factory = viewModelFactory {
                initializer { ApprovalsViewModel(app.api, focus) }
            })
            val state by vm.state.collectAsStateWithLifecycle()
            LaunchedEffect(state.signedOut) { if (state.signedOut) nav.toLogin() }
            ApprovalsScreen(state, vm, onBack = { if (!nav.popBackStack()) nav.navigate(Routes.ROOMS) })
        }

        composable(
            Routes.TASK,
            arguments = listOf(
                navArgument("taskId") { type = NavType.StringType },
                navArgument("orgId") { type = NavType.StringType; nullable = true; defaultValue = null },
            ),
        ) { entry ->
            val taskId = entry.arguments?.getString("taskId").orEmpty()
            val orgId = entry.arguments?.getString("orgId")?.toIntOrNull()
            val vm: ComputerUseTaskViewModel = viewModel(key = "task:$taskId", factory = viewModelFactory {
                initializer { ComputerUseTaskViewModel(app.api, taskId, orgId) }
            })
            val state by vm.state.collectAsStateWithLifecycle()
            LaunchedEffect(state.signedOut) { if (state.signedOut) nav.toLogin() }
            ComputerUseTaskScreen(state, vm, onBack = {
                // Opened cold from a notification, there is nothing behind it.
                if (!nav.popBackStack()) nav.navigate(Routes.ROOMS)
            })
        }

        composable(
            Routes.ROOM,
            arguments = listOf(
                navArgument("key") { type = NavType.StringType },
                navArgument("gmailAlert") { type = NavType.StringType; nullable = true; defaultValue = null },
                navArgument("orgId") { type = NavType.StringType; nullable = true; defaultValue = null },
            ),
        ) { entry ->
            val key = entry.arguments?.getString("key").orEmpty()
            val orgId = entry.arguments?.getString("orgId")?.toIntOrNull()
            val gmailAlert = entry.arguments?.getString("gmailAlert")?.toIntOrNull()
            val vm: RoomViewModel = viewModel(key = "room:$key", factory = viewModelFactory {
                initializer { RoomViewModel(app.api, key, app.roomCache, app.scope, initialOrgId = orgId) }
            })
            val state by vm.state.collectAsStateWithLifecycle()
            LaunchedEffect(state.signedOut) { if (state.signedOut) nav.toLogin() }
            RoomScreen(
                viewModel = vm,
                state = state,
                serverUrl = app.session.serverUrl.orEmpty(),
                showTurnDetails = app.session.showTurnDetails,
                mapLocation = MapLocationPrefs(
                    enabled = app.session.useLocationOnMaps,
                    asked = app.session.askedLocationPermission,
                    markAsked = { app.session.askedLocationPermission = true },
                ),
                gmailAlert = gmailAlert,
                onBack = { nav.popBackStack() },
            )
        }
    }
}

private fun NavHostController.toLogin() {
    navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } }
}

/** Asks for POST_NOTIFICATIONS once (Android 13+), then lets the caller re-register. */
@Composable
private fun NotificationPermissionPrompt(app: CrewApplication, onResult: () -> Unit) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { onResult() }
    LaunchedEffect(Unit) {
        if (!PushRegistrar.permissionGranted(app) && !app.session.askedNotificationPermission) {
            app.session.askedNotificationPermission = true
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
