plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Push needs the Firebase project's google-services.json in app/. Without it the
// app still builds and runs, with phone notifications switched off (see
// PushRegistrar), so a fresh checkout does not need Firebase credentials.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

/**
 * The Mapbox PUBLIC token (pk.…) the map cards draw with: the MAPBOX_ACCESS_TOKEN
 * Gradle property or environment variable, `mapbox.token` in local.properties,
 * or the repo's own .env (the token the web client already ships). A secret
 * sk.… token is refused: anything put here is readable inside the APK. Without
 * a token the app builds, and map cards list their places instead.
 */
val mapboxToken: String = run {
    val local = rootProject.file("local.properties").takeIf { it.exists() }?.readLines().orEmpty()
        .firstOrNull { it.startsWith("mapbox.token=") }?.substringAfter('=')
    val dotEnv = rootProject.file("../.env").takeIf { it.exists() }?.readLines().orEmpty()
        .firstOrNull { it.startsWith("MAPBOX_ACCESS_TOKEN=") }?.substringAfter('=')
    listOfNotNull(
        providers.gradleProperty("MAPBOX_ACCESS_TOKEN").orNull,
        System.getenv("MAPBOX_ACCESS_TOKEN"),
        local,
        dotEnv,
    ).map { it.trim().trim('"') }.firstOrNull { it.startsWith("pk.") }.orEmpty()
}

android {
    namespace = "app.oddjob.crew"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.oddjob.crew"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        // The emulator reaches the host's localhost on 10.0.2.2; a phone needs the LAN address or a deployed origin.
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"http://10.0.2.2:5000\"")
        // The Maps SDK reads its token from this string resource.
        resValue("string", "mapbox_access_token", mapboxToken)
        buildConfigField("boolean", "MAPS_ENABLED", mapboxToken.isNotEmpty().toString())
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "DEFAULT_SERVER_URL", "\"https://\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
        resValues = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.core)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.okhttp.sse)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.mapbox.android)
    implementation(libs.mapbox.compose)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.kotlinx.coroutines.play.services)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
