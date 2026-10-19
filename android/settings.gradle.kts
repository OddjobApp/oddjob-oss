pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Mapbox Maps SDK. The repository is public now; no secret downloads token is needed.
        maven("https://api.mapbox.com/downloads/v2/releases/maven")
    }
}

rootProject.name = "oddjob-crew"
include(":app")
