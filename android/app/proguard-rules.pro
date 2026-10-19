# kotlinx.serialization: keep generated serializers for the DTOs.
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class app.oddjob.crew.data.** {
    *** Companion;
}
-keepclasseswithmembers class app.oddjob.crew.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}
