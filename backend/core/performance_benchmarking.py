"""
Performance Benchmarking Utilities
Comprehensive performance testing and benchmarking tools
"""

import asyncio
import time
import statistics
import json
from typing import Dict, List, Any, Optional, Callable, Awaitable, TypeVar, Union
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from contextlib import asynccontextmanager
import psutil
import threading
from concurrent.futures import ThreadPoolExecutor
import tracemalloc

from core.structured_logging import get_structured_logger
from core.config import settings

logger = get_structured_logger("performance_benchmarking")

T = TypeVar('T')


@dataclass
class BenchmarkResult:
    """Result of a benchmark run."""
    operation: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Timing metrics
    total_time: float = 0.0
    min_time: float = float('inf')
    max_time: float = 0.0
    mean_time: float = 0.0
    median_time: float = 0.0
    std_dev: float = 0.0

    # Throughput metrics
    operations_per_second: float = 0.0
    total_operations: int = 0

    # Resource metrics
    peak_memory_mb: float = 0.0
    cpu_percent_avg: float = 0.0
    cpu_percent_peak: float = 0.0

    # Performance percentiles
    p50: float = 0.0
    p95: float = 0.0
    p99: float = 0.0

    # Raw timing data
    timings: List[float] = field(default_factory=list)

    # Additional metadata
    metadata: Dict[str, Any] = field(default_factory=dict)

    def calculate_statistics(self) -> None:
        """Calculate statistical metrics from timing data."""
        if not self.timings:
            return

        self.total_time = sum(self.timings)
        self.min_time = min(self.timings)
        self.max_time = max(self.timings)
        self.mean_time = statistics.mean(self.timings)
        self.median_time = statistics.median(self.timings)
        self.std_dev = statistics.stdev(self.timings) if len(self.timings) > 1 else 0.0

        # Calculate percentiles
        sorted_timings = sorted(self.timings)
        self.p50 = sorted_timings[int(len(sorted_timings) * 0.5)]
        self.p95 = sorted_timings[int(len(sorted_timings) * 0.95)]
        self.p99 = sorted_timings[int(len(sorted_timings) * 0.99)]

        # Calculate throughput
        if self.total_time > 0:
            self.operations_per_second = len(self.timings) / self.total_time

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        data = asdict(self)
        data["timestamp"] = self.timestamp.isoformat()
        return data


class ResourceMonitor:
    """Monitor system resources during benchmarking."""

    def __init__(self):
        self.start_memory = 0
        self.peak_memory = 0
        self.cpu_samples: List[float] = []
        self.monitoring = False
        self.monitor_thread: Optional[threading.Thread] = None

    def start_monitoring(self) -> None:
        """Start resource monitoring."""
        tracemalloc.start()
        self.start_memory = psutil.Process().memory_info().rss / 1024 / 1024  # MB
        self.monitoring = True

        # Start CPU monitoring thread
        self.monitor_thread = threading.Thread(target=self._monitor_cpu, daemon=True)
        self.monitor_thread.start()

    def stop_monitoring(self) -> tuple[float, float, float]:
        """
        Stop monitoring and return resource usage metrics.

        Returns:
            Tuple of (peak_memory_mb, avg_cpu_percent, peak_cpu_percent)
        """
        self.monitoring = False

        if self.monitor_thread:
            self.monitor_thread.join(timeout=1.0)

        # Get final memory usage
        current_memory = psutil.Process().memory_info().rss / 1024 / 1024  # MB
        self.peak_memory = max(self.peak_memory, current_memory)

        # Calculate CPU metrics
        avg_cpu = statistics.mean(self.cpu_samples) if self.cpu_samples else 0.0
        peak_cpu = max(self.cpu_samples) if self.cpu_samples else 0.0

        # Stop memory tracing
        tracemalloc.stop()

        return self.peak_memory, avg_cpu, peak_cpu

    def _monitor_cpu(self) -> None:
        """Monitor CPU usage in background thread."""
        while self.monitoring:
            try:
                cpu_percent = psutil.cpu_percent(interval=0.1)
                self.cpu_samples.append(cpu_percent)

                # Update peak memory
                current_memory = psutil.Process().memory_info().rss / 1024 / 1024  # MB
                self.peak_memory = max(self.peak_memory, current_memory)

            except Exception as e:
                logger.warning(f"Failed to monitor resources: {e}")

            time.sleep(0.1)


class PerformanceBenchmarker:
    """Main benchmarking utility class."""

    def __init__(self):
        self.resource_monitor = ResourceMonitor()
        self.results: List[BenchmarkResult] = []
        self.logger = get_structured_logger("benchmarker")

    @asynccontextmanager
    async def benchmark_context(
        self,
        operation: str,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """Context manager for benchmarking operations."""
        result = BenchmarkResult(operation=operation, metadata=metadata or {})

        # Start monitoring
        self.resource_monitor.start_monitoring()
        start_time = time.time()

        try:
            yield result
        finally:
            # Stop monitoring and collect metrics
            duration = time.time() - start_time
            peak_memory, avg_cpu, peak_cpu = self.resource_monitor.stop_monitoring()

            # Update result with monitoring data
            result.total_time = duration
            result.peak_memory_mb = peak_memory
            result.cpu_percent_avg = avg_cpu
            result.cpu_percent_peak = peak_cpu

            # Calculate statistics
            result.calculate_statistics()

            # Store result
            self.results.append(result)

            # Log benchmark result
            self.logger.info(
                f"Benchmark completed: {operation}",
                extra={
                    "operation": operation,
                    "duration": duration,
                    "operations_per_second": result.operations_per_second,
                    "peak_memory_mb": peak_memory,
                    "avg_cpu_percent": avg_cpu
                }
            )

    async def benchmark_function(
        self,
        func: Callable[..., Awaitable[T]],
        *args,
        operation: Optional[str] = None,
        iterations: int = 100,
        warmup_iterations: int = 10,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> BenchmarkResult:
        """
        Benchmark a function by running it multiple times.

        Args:
            func: Function to benchmark
            operation: Name of the operation (defaults to function name)
            iterations: Number of benchmark iterations
            warmup_iterations: Number of warmup iterations
            metadata: Additional metadata for the benchmark
        """
        operation_name = operation or f"{func.__module__}.{func.__name__}"
        result = BenchmarkResult(
            operation=operation_name,
            metadata=metadata or {},
            total_operations=iterations
        )

        self.logger.info(f"Starting benchmark: {operation_name} ({iterations} iterations)")

        # Warmup phase
        if warmup_iterations > 0:
            self.logger.debug(f"Warmup: {warmup_iterations} iterations")
            for _ in range(warmup_iterations):
                await func(*args, **kwargs)

        # Benchmark phase
        self.resource_monitor.start_monitoring()

        for i in range(iterations):
            start_time = time.time()
            await func(*args, **kwargs)
            end_time = time.time()

            execution_time = end_time - start_time
            result.timings.append(execution_time)

        # Stop monitoring
        peak_memory, avg_cpu, peak_cpu = self.resource_monitor.stop_monitoring()

        # Update result with monitoring data
        result.peak_memory_mb = peak_memory
        result.cpu_percent_avg = avg_cpu
        result.cpu_percent_peak = peak_cpu

        # Calculate statistics
        result.calculate_statistics()

        # Store result
        self.results.append(result)

        self.logger.info(
            f"Benchmark completed: {operation_name}",
            extra={
                "operation": operation_name,
                "iterations": iterations,
                "mean_time": result.mean_time,
                "operations_per_second": result.operations_per_second,
                "p95_time": result.p95
            }
        )

        return result

    async def benchmark_concurrent(
        self,
        func: Callable[..., Awaitable[T]],
        concurrency: int,
        total_operations: int,
        *args,
        operation: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> BenchmarkResult:
        """
        Benchmark function under concurrent load.

        Args:
            func: Function to benchmark
            concurrency: Number of concurrent operations
            total_operations: Total number of operations to perform
            operation: Name of the operation
        """
        operation_name = operation or f"{func.__module__}.{func.__name__}_concurrent"
        result = BenchmarkResult(
            operation=operation_name,
            metadata=metadata or {},
            total_operations=total_operations
        )

        self.logger.info(
            f"Starting concurrent benchmark: {operation_name} "
            f"({concurrency} concurrent, {total_operations} total)"
        )

        async def worker(worker_id: int) -> List[float]:
            """Worker function that performs operations and returns timings."""
            timings = []
            operations_per_worker = total_operations // concurrency

            for _ in range(operations_per_worker):
                start_time = time.time()
                await func(*args, **kwargs)
                end_time = time.time()
                timings.append(end_time - start_time)

            return timings

        # Start monitoring
        self.resource_monitor.start_monitoring()
        benchmark_start = time.time()

        # Run concurrent workers
        tasks = [worker(i) for i in range(concurrency)]
        worker_results = await asyncio.gather(*tasks)

        benchmark_duration = time.time() - benchmark_start

        # Stop monitoring
        peak_memory, avg_cpu, peak_cpu = self.resource_monitor.stop_monitoring()

        # Collect all timings
        all_timings = []
        for worker_timings in worker_results:
            all_timings.extend(worker_timings)

        # Update result
        result.timings = all_timings
        result.total_time = benchmark_duration
        result.peak_memory_mb = peak_memory
        result.cpu_percent_avg = avg_cpu
        result.cpu_percent_peak = peak_cpu

        # Calculate statistics
        result.calculate_statistics()

        # Store result
        self.results.append(result)

        self.logger.info(
            f"Concurrent benchmark completed: {operation_name}",
            extra={
                "operation": operation_name,
                "concurrency": concurrency,
                "total_operations": total_operations,
                "mean_time": result.mean_time,
                "operations_per_second": result.operations_per_second,
                "p95_time": result.p95
            }
        )

        return result

    def compare_results(
        self,
        result1: BenchmarkResult,
        result2: BenchmarkResult,
        baseline_name: str = "baseline",
        comparison_name: str = "comparison"
    ) -> Dict[str, Any]:
        """Compare two benchmark results."""
        comparison = {
            "baseline": result1.to_dict(),
            "comparison": result2.to_dict(),
            "improvements": {},
            "regressions": {}
        }

        # Compare key metrics
        metrics_to_compare = [
            "mean_time", "median_time", "p95", "p99",
            "operations_per_second", "peak_memory_mb", "cpu_percent_avg"
        ]

        for metric in metrics_to_compare:
            baseline_value = getattr(result1, metric, 0)
            comparison_value = getattr(result2, metric, 0)

            if baseline_value == 0:
                continue

            change_percent = ((comparison_value - baseline_value) / baseline_value) * 100

            if metric in ["mean_time", "median_time", "p95", "p99", "peak_memory_mb", "cpu_percent_avg"]:
                # Lower is better for these metrics
                if change_percent < -5:  # 5% improvement threshold
                    comparison["improvements"][metric] = {
                        "change_percent": change_percent,
                        "baseline": baseline_value,
                        "comparison": comparison_value
                    }
                elif change_percent > 5:  # 5% regression threshold
                    comparison["regressions"][metric] = {
                        "change_percent": change_percent,
                        "baseline": baseline_value,
                        "comparison": comparison_value
                    }
            else:
                # Higher is better for these metrics
                if change_percent > 5:
                    comparison["improvements"][metric] = {
                        "change_percent": change_percent,
                        "baseline": baseline_value,
                        "comparison": comparison_value
                    }
                elif change_percent < -5:
                    comparison["regressions"][metric] = {
                        "change_percent": change_percent,
                        "baseline": baseline_value,
                        "comparison": comparison_value
                    }

        return comparison

    def export_results(self, filename: str) -> None:
        """Export benchmark results to JSON file."""
        results_data = {
            "export_timestamp": datetime.now(timezone.utc).isoformat(),
            "results": [result.to_dict() for result in self.results]
        }

        with open(filename, 'w') as f:
            json.dump(results_data, f, indent=2, default=str)

        self.logger.info(f"Exported {len(self.results)} benchmark results to {filename}")

    def get_summary_report(self) -> Dict[str, Any]:
        """Generate a summary report of all benchmark results."""
        if not self.results:
            return {"message": "No benchmark results available"}

        summary = {
            "total_benchmarks": len(self.results),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "benchmarks": []
        }

        for result in self.results:
            benchmark_summary = {
                "operation": result.operation,
                "total_operations": result.total_operations,
                "mean_time": result.mean_time,
                "operations_per_second": result.operations_per_second,
                "p95_time": result.p95,
                "peak_memory_mb": result.peak_memory_mb,
                "cpu_percent_avg": result.cpu_percent_avg
            }
            summary["benchmarks"].append(benchmark_summary)

        return summary


# Global benchmarker instance
benchmarker = PerformanceBenchmarker()


# Convenience functions for common benchmarking scenarios
async def benchmark_api_endpoint(
    endpoint_func: Callable,
    *args,
    iterations: int = 50,
    **kwargs
) -> BenchmarkResult:
    """Benchmark an API endpoint function."""
    return await benchmarker.benchmark_function(
        endpoint_func,
        *args,
        operation=f"api_{endpoint_func.__name__}",
        iterations=iterations,
        metadata={"type": "api_endpoint"},
        **kwargs
    )


async def benchmark_database_operation(
    db_func: Callable,
    *args,
    iterations: int = 100,
    **kwargs
) -> BenchmarkResult:
    """Benchmark a database operation."""
    return await benchmarker.benchmark_function(
        db_func,
        *args,
        operation=f"db_{db_func.__name__}",
        iterations=iterations,
        metadata={"type": "database_operation"},
        **kwargs
    )


async def benchmark_ai_service(
    ai_func: Callable,
    *args,
    iterations: int = 10,
    **kwargs
) -> BenchmarkResult:
    """Benchmark an AI service call."""
    return await benchmarker.benchmark_function(
        ai_func,
        *args,
        operation=f"ai_{ai_func.__name__}",
        iterations=iterations,
        metadata={"type": "ai_service"},
        **kwargs
    )


def export_benchmark_report(filename: str = "benchmark_report.json") -> None:
    """Export a comprehensive benchmark report."""
    benchmarker.export_results(filename)


def get_performance_summary() -> Dict[str, Any]:
    """Get a summary of performance benchmarks."""
    return benchmarker.get_summary_report()