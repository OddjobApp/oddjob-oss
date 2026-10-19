package com.oddjob.forge.backend;

import java.util.HashMap;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

	@GetMapping("/api/health")
	public Map<String, Object> health() {
		Map<String, Object> response = new HashMap<>();
		response.put("status", "healthy");
		response.put("runtime", "java/spring-boot");
		response.put("message", "Oddjob Java/Spring Boot Backend Service Operational");
		return response;
	}
}
