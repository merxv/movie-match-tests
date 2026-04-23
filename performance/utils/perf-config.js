import http from 'k6/http';
import { check } from 'k6';

export const profileDefinitions = {
  normal: {
    scenarios: {
      normal_load: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
          { duration: '1m', target: 5 },
          { duration: '3m', target: 10 },
          { duration: '1m', target: 0 },
        ],
        gracefulRampDown: '30s',
      },
    },
    sleepSeconds: 1,
    thresholds: {
      http_req_failed: ['rate<0.01'],
      http_req_duration: ['p(95)<800', 'avg<450'],
      application_errors: ['rate<0.01'],
      movies_duration: ['p(95)<700'],
      recommendations_duration: ['p(95)<900'],
      auth_duration: ['p(95)<700'],
      profile_duration: ['p(95)<850'],
    },
    thresholdNotes: {
      p95: '< 800 ms overall; recommendations < 900 ms',
      errorRate: '< 1%',
      throughput: 'Stable without queue buildup at 10 VUs',
    },
  },
  peak: {
    scenarios: {
      peak_load: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
          { duration: '2m', target: 10 },
          { duration: '4m', target: 25 },
          { duration: '4m', target: 40 },
          { duration: '1m', target: 0 },
        ],
        gracefulRampDown: '45s',
      },
    },
    sleepSeconds: 0.7,
    thresholds: {
      http_req_failed: ['rate<0.02'],
      http_req_duration: ['p(95)<1500', 'avg<800'],
      application_errors: ['rate<0.02'],
      movies_duration: ['p(95)<1200'],
      recommendations_duration: ['p(95)<1700'],
      auth_duration: ['p(95)<1100'],
      profile_duration: ['p(95)<1400'],
    },
    thresholdNotes: {
      p95: '< 1500 ms overall',
      errorRate: '< 2%',
      throughput: 'Maintain service quality at 40 VUs',
    },
  },
  spike: {
    scenarios: {
      spike_load: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
          { duration: '30s', target: 10 },
          { duration: '30s', target: 80 },
          { duration: '1m', target: 80 },
          { duration: '30s', target: 10 },
          { duration: '30s', target: 0 },
        ],
        gracefulRampDown: '30s',
      },
    },
    sleepSeconds: 0.3,
    thresholds: {
      http_req_failed: ['rate<0.05'],
      http_req_duration: ['p(95)<2500', 'avg<1200'],
      application_errors: ['rate<0.05'],
      movies_duration: ['p(95)<1800'],
      recommendations_duration: ['p(95)<2500'],
      auth_duration: ['p(95)<1600'],
      profile_duration: ['p(95)<2000'],
    },
    thresholdNotes: {
      p95: '< 2500 ms overall during spike recovery window',
      errorRate: '< 5%',
      throughput: 'System recovers after jump to 80 VUs',
    },
  },
  endurance: {
    scenarios: {
      endurance_load: {
        executor: 'constant-vus',
        vus: 15,
        duration: '20m',
      },
    },
    sleepSeconds: 1.2,
    thresholds: {
      http_req_failed: ['rate<0.02'],
      http_req_duration: ['p(95)<1200', 'avg<650'],
      application_errors: ['rate<0.02'],
      movies_duration: ['p(95)<900'],
      recommendations_duration: ['p(95)<1300'],
      auth_duration: ['p(95)<900'],
      profile_duration: ['p(95)<1100'],
    },
    thresholdNotes: {
      p95: '< 1200 ms overall throughout 20 minutes',
      errorRate: '< 2%',
      throughput: 'No progressive degradation, leaks, or saturation',
    },
  },
};

export function getProfileName() {
  const requested = `${__ENV.PERF_PROFILE || 'normal'}`.toLowerCase();
  return profileDefinitions[requested] ? requested : 'normal';
}

export function getBaseUrl() {
  return __ENV.BASE_URL || 'http://127.0.0.1:4000';
}

export function buildOptions(profileName) {
  const profile = profileDefinitions[profileName];

  return {
    scenarios: profile.scenarios,
    thresholds: profile.thresholds,
    summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'min', 'max'],
    insecureSkipTLSVerify: true,
  };
}

export function jsonHeaders(token) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function loginUser(baseUrl, email, password) {
  const response = http.post(
    `${baseUrl}/api/users/login`,
    JSON.stringify({ email, password }),
    { headers: jsonHeaders() },
  );

  check(response, {
    [`setup login for ${email} returned 200`]: (res) => res.status === 200,
  });

  return {
    token: response.json('token'),
    userId: response.json('user.id'),
  };
}

function metricValue(data, name, stat) {
  return data.metrics?.[name]?.values?.[stat] ?? null;
}

function rateValue(data, name) {
  return data.metrics?.[name]?.values?.rate ?? null;
}

export function createSummary(data, context) {
  const summary = {
    generatedAt: new Date().toISOString(),
    profile: context.profileName,
    baseUrl: context.baseUrl,
    highRiskModules: context.highRiskModules,
    thresholds: context.thresholds,
    metrics: {
      httpReqDuration: {
        avg: metricValue(data, 'http_req_duration', 'avg'),
        median: metricValue(data, 'http_req_duration', 'med'),
        p95: metricValue(data, 'http_req_duration', 'p(95)'),
      },
      throughput: {
        requestsPerSecond: metricValue(data, 'http_reqs', 'rate'),
        iterationsPerSecond: metricValue(data, 'iterations', 'rate'),
      },
      errorRate: {
        httpReqFailed: rateValue(data, 'http_req_failed'),
        applicationErrors: rateValue(data, 'application_errors'),
      },
      endpointDurations: {
        movies: {
          avg: metricValue(data, 'movies_duration', 'avg'),
          median: metricValue(data, 'movies_duration', 'med'),
          p95: metricValue(data, 'movies_duration', 'p(95)'),
        },
        recommendations: {
          avg: metricValue(data, 'recommendations_duration', 'avg'),
          median: metricValue(data, 'recommendations_duration', 'med'),
          p95: metricValue(data, 'recommendations_duration', 'p(95)'),
        },
        auth: {
          avg: metricValue(data, 'auth_duration', 'avg'),
          median: metricValue(data, 'auth_duration', 'med'),
          p95: metricValue(data, 'auth_duration', 'p(95)'),
        },
        profile: {
          avg: metricValue(data, 'profile_duration', 'avg'),
          median: metricValue(data, 'profile_duration', 'med'),
          p95: metricValue(data, 'profile_duration', 'p(95)'),
        },
      },
      checks: {
        rate: rateValue(data, 'checks'),
      },
      businessFlowsCompleted: metricValue(data, 'completed_business_flows', 'count'),
    },
    rawMetrics: data.metrics,
  };

  return {
    stdout: `${JSON.stringify(summary, null, 2)}\n`,
    [`performance/results/${context.profileName}-summary.json`]: JSON.stringify(summary, null, 2),
    'performance/results/latest-summary.json': JSON.stringify(summary, null, 2),
  };
}
