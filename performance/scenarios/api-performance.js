import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import {
  buildOptions,
  createSummary,
  getBaseUrl,
  getProfileName,
  jsonHeaders,
  loginUser,
  profileDefinitions,
} from '../utils/perf-config.js';

const profileName = getProfileName();
const profile = profileDefinitions[profileName];
const baseUrl = getBaseUrl();

export const options = buildOptions(profileName);

const applicationErrors = new Rate('application_errors');
const authDuration = new Trend('auth_duration', true);
const moviesDuration = new Trend('movies_duration', true);
const recommendationsDuration = new Trend('recommendations_duration', true);
const profileDuration = new Trend('profile_duration', true);
const completedBusinessFlows = new Counter('completed_business_flows');

export function setup() {
  const steve = loginUser(baseUrl, 'steve@example.com', '123');
  const amy = loginUser(baseUrl, 'amy@example.com', '123');

  const catalogResponse = http.get(`${baseUrl}/api/movies`);
  check(catalogResponse, {
    'setup catalog returned 200': (response) => response.status === 200,
  });

  const catalog = catalogResponse.status === 200 ? catalogResponse.json() : [];
  const candidateMovie = Array.isArray(catalog)
    ? catalog.find((movie) => movie && movie._id && movie._id !== '660000000000000000000101')
    : null;

  return {
    steveToken: steve.token,
    amyToken: amy.token,
    candidateMovieId: candidateMovie?._id || null,
    scenarioProfile: profileName,
  };
}

export default function (data) {
  const token = __VU % 2 === 0 ? data.steveToken : data.amyToken;
  const authHeaders = {
    Authorization: `Bearer ${token}`,
  };

  group('movie catalog', () => {
    const response = http.get(`${baseUrl}/api/movies`);
    moviesDuration.add(response.timings.duration);
    const ok = check(response, {
      'movies returned 200': (res) => res.status === 200,
      'movies payload is an array': (res) => Array.isArray(res.json()),
    });
    applicationErrors.add(!ok);
  });

  group('recommendations', () => {
    const response = http.get(`${baseUrl}/api/recommend`, { headers: authHeaders });
    recommendationsDuration.add(response.timings.duration);
    const ok = check(response, {
      'recommendations returned 200': (res) => res.status === 200,
      'recommendations payload is an array': (res) => Array.isArray(res.json()),
    });
    applicationErrors.add(!ok);
  });

  group('authentication and profile', () => {
    const authStart = Date.now();
    const loginResponse = http.post(
      `${baseUrl}/api/users/login`,
      JSON.stringify({
        email: __VU % 2 === 0 ? 'steve@example.com' : 'amy@example.com',
        password: '123',
      }),
      { headers: jsonHeaders() },
    );
    authDuration.add(Date.now() - authStart);

    const loginOk = check(loginResponse, {
      'login returned 200': (res) => res.status === 200,
      'login returned token': (res) => Boolean(res.json('token')),
    });
    applicationErrors.add(!loginOk);

    if (!loginOk) {
      return;
    }

    const response = http.get(`${baseUrl}/api/users/profile`, {
      headers: {
        Authorization: `Bearer ${loginResponse.json('token')}`,
      },
    });
    profileDuration.add(response.timings.duration);
    const ok = check(response, {
      'profile returned 200': (res) => res.status === 200,
      'profile contains likedMovies': (res) => Array.isArray(res.json('likedMovies')),
    });
    applicationErrors.add(!ok);
  });

  completedBusinessFlows.add(1);
  sleep(profile.sleepSeconds);
}

export function handleSummary(data) {
  return createSummary(data, {
    profileName,
    baseUrl,
    highRiskModules: [
      'Movie catalog read path (MongoDB full collection scan)',
      'Recommendation engine (Neo4j hybrid query merge)',
      'Authentication/profile flow (bcrypt + JWT + Mongo populate)',
    ],
    thresholds: profile.thresholdNotes,
  });
}
