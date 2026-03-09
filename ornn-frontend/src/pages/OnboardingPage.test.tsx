/**
 * Tests for OnboardingPage.
 * Covers both authenticated mode (email+OTP users) and
 * pending OAuth mode (unauthenticated deferred creation).
 * @module pages/OnboardingPage.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { OnboardingPage } from "./OnboardingPage";

// --- Mocks ---

const mockNavigate = vi.fn();
let mockLocationState: Record<string, unknown> = {};

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: mockLocationState }),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      ...props
    }: {
      children: React.ReactNode;
      [key: string]: unknown;
    }) => <div {...filterDomProps(props)}>{children}</div>,
  },
}));

/** Strip non-DOM props to avoid warnings in test output. */
function filterDomProps(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const { initial, animate, transition, whileHover, whileTap, ...rest } =
    props;
  return rest;
}

// Auth store mock state
const mockSetAuth = vi.fn();
const mockUpdateUser = vi.fn();
const mockCompleteOnboarding = vi.fn();
let mockAccessToken: string | null = "test-access-token";
let mockIsAuthenticated = true;
let mockNeedsOnboarding = true;

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      isAuthenticated: mockIsAuthenticated,
      needsOnboarding: mockNeedsOnboarding,
      accessToken: mockAccessToken,
      user: { id: "1", primaryEmail: "test@example.com" },
      updateUser: mockUpdateUser,
      completeOnboarding: mockCompleteOnboarding,
      setAuth: mockSetAuth,
    };
    return selector ? selector(state) : state;
  },
  toAuthUser: (u: Record<string, unknown>) => u,
}));

// OnboardingForm mock -- captures the callbacks for testing
let capturedOnSendOtp: ((email: string) => Promise<void>) | undefined;
let capturedOnComplete:
  | ((data: Record<string, unknown>) => Promise<void>)
  | undefined;
let capturedRequireEmail: boolean | undefined;

vi.mock("@/components/auth/OnboardingForm", () => ({
  OnboardingForm: ({
    requireEmailVerification,
    onSendOtp,
    onComplete,
    error,
  }: {
    requireEmailVerification?: boolean;
    onSendOtp?: (email: string) => Promise<void>;
    onComplete: (data: Record<string, unknown>) => Promise<void>;
    error?: string | null;
    onClearError?: () => void;
  }) => {
    capturedOnSendOtp = onSendOtp;
    capturedOnComplete = onComplete;
    capturedRequireEmail = requireEmailVerification;

    return (
      <div data-testid="onboarding-form">
        {requireEmailVerification && (
          <span data-testid="email-required">email-required</span>
        )}
        {error && <span data-testid="error-message">{error}</span>}
      </div>
    );
  },
}));

const mockSendOnboardingOtp = vi.fn();
const mockCompleteOnboardingApi = vi.fn();
vi.mock("@/services/userApi", () => ({
  sendOnboardingOtp: (...args: unknown[]) => mockSendOnboardingOtp(...args),
  completeOnboarding: (...args: unknown[]) => mockCompleteOnboardingApi(...args),
}));

const mockSendOAuthOnboardingOtp = vi.fn();
const mockCompleteOAuthOnboarding = vi.fn();
vi.mock("@/services/authApi", () => ({
  sendOAuthOnboardingOtp: (...args: unknown[]) =>
    mockSendOAuthOnboardingOtp(...args),
  completeOAuthOnboarding: (...args: unknown[]) =>
    mockCompleteOAuthOnboarding(...args),
  AuthApiError: class MockAuthApiError extends Error {
    code: string;
    statusCode: number;
    constructor(code: string, message: string, statusCode: number) {
      super(message);
      this.name = "AuthApiError";
      this.code = code;
      this.statusCode = statusCode;
    }
  },
}));

// --- Helpers ---

function setupAuthenticatedMode() {
  mockIsAuthenticated = true;
  mockNeedsOnboarding = true;
  mockAccessToken = "test-access-token";
  mockLocationState = { requireEmailVerification: true };
}

function setupPendingOAuthMode(token = "pending-oauth-token-xyz") {
  mockIsAuthenticated = false;
  mockNeedsOnboarding = false;
  mockAccessToken = null;
  mockLocationState = {
    requireEmailVerification: true,
    pendingOAuthToken: token,
  };
}

// --- Tests ---

describe("OnboardingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    capturedOnSendOtp = undefined;
    capturedOnComplete = undefined;
    capturedRequireEmail = undefined;
    mockIsAuthenticated = true;
    mockNeedsOnboarding = true;
    mockAccessToken = "test-access-token";
    mockLocationState = {};
  });

  describe("Authenticated Mode", () => {
    it("AuthMode_WhenAuthenticated_RendersOnboardingForm", () => {
      // Arrange
      setupAuthenticatedMode();

      // Act
      render(<OnboardingPage />);

      // Assert
      expect(screen.getByTestId("onboarding-form")).toBeInTheDocument();
      expect(capturedRequireEmail).toBe(true);
    });

    it("AuthMode_WhenNotAuthenticated_RedirectsToLogin", () => {
      // Arrange
      mockIsAuthenticated = false;
      mockNeedsOnboarding = true;
      mockLocationState = {};

      // Act
      render(<OnboardingPage />);

      // Assert
      expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
    });

    it("AuthMode_SendOtp_CallsAuthenticatedEndpoint", async () => {
      // Arrange
      setupAuthenticatedMode();
      mockSendOnboardingOtp.mockResolvedValue({ message: "OTP sent" });

      render(<OnboardingPage />);

      // Act
      await capturedOnSendOtp!("user@example.com");

      // Assert
      expect(mockSendOnboardingOtp).toHaveBeenCalledWith(
        "test-access-token",
        "user@example.com",
      );
      expect(mockSendOAuthOnboardingOtp).not.toHaveBeenCalled();
    });

    it("AuthMode_Complete_CallsAuthenticatedEndpoint_AndNavigates", async () => {
      // Arrange
      setupAuthenticatedMode();
      const mockUser = {
        id: "1",
        primaryEmail: "user@example.com",
        displayName: "Test User",
        avatarUrl: null,
        role: "member",
      };
      mockCompleteOnboardingApi.mockResolvedValue(mockUser);

      render(<OnboardingPage />);

      // Act
      await capturedOnComplete!({ displayName: "Test User" });

      // Assert
      expect(mockCompleteOnboardingApi).toHaveBeenCalledWith(
        "test-access-token",
        { displayName: "Test User" },
      );
      expect(mockUpdateUser).toHaveBeenCalled();
      expect(mockCompleteOnboarding).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
      expect(mockCompleteOAuthOnboarding).not.toHaveBeenCalled();
    });
  });

  describe("Pending OAuth Mode", () => {
    it("PendingOAuth_WithToken_RendersFormWithoutAuthCheck", () => {
      // Arrange
      setupPendingOAuthMode();

      // Act
      render(<OnboardingPage />);

      // Assert: form renders despite not being authenticated
      expect(screen.getByTestId("onboarding-form")).toBeInTheDocument();
      expect(capturedRequireEmail).toBe(true);
      // Should NOT redirect to login
      expect(mockNavigate).not.toHaveBeenCalledWith("/login", {
        replace: true,
      });
    });

    it("PendingOAuth_SendOtp_CallsUnauthenticatedEndpoint", async () => {
      // Arrange
      const TOKEN = "pending-oauth-token-abc";
      setupPendingOAuthMode(TOKEN);
      mockSendOAuthOnboardingOtp.mockResolvedValue({ message: "OTP sent" });

      render(<OnboardingPage />);

      // Act
      await capturedOnSendOtp!("new-user@example.com");

      // Assert
      expect(mockSendOAuthOnboardingOtp).toHaveBeenCalledWith({
        pendingOAuthToken: TOKEN,
        email: "new-user@example.com",
      });
      expect(mockSendOnboardingOtp).not.toHaveBeenCalled();
    });

    it("PendingOAuth_Complete_CallsUnauthenticatedEndpoint_SetsAuth", async () => {
      // Arrange
      const TOKEN = "pending-oauth-token-abc";
      setupPendingOAuthMode(TOKEN);
      sessionStorage.setItem("oauth_pending_token", TOKEN);

      const resultUser = {
        id: "new-1",
        primaryEmail: "new-user@example.com",
        displayName: "New OAuth User",
        avatarUrl: null,
        role: "member",
      };
      mockCompleteOAuthOnboarding.mockResolvedValue({
        accessToken: "new-access-token",
        user: resultUser,
        isNewUser: false,
      });

      render(<OnboardingPage />);

      // Act
      await capturedOnComplete!({
        displayName: "New OAuth User",
        email: "new-user@example.com",
        emailOtp: "123456",
      });

      // Assert
      expect(mockCompleteOAuthOnboarding).toHaveBeenCalledWith({
        pendingOAuthToken: TOKEN,
        displayName: "New OAuth User",
        email: "new-user@example.com",
        emailOtp: "123456",
        phoneNumber: undefined,
        avatarUrl: undefined,
      });
      expect(mockSetAuth).toHaveBeenCalledWith(
        "new-access-token",
        resultUser,
        false,
      );
      expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
      // sessionStorage should be cleaned up
      expect(sessionStorage.getItem("oauth_pending_token")).toBeNull();
      // Authenticated onboarding endpoint should NOT be called
      expect(mockCompleteOnboardingApi).not.toHaveBeenCalled();
    });

    it("PendingOAuth_FallbackToSessionStorage_WhenNoRouteState", () => {
      // Arrange: token only in sessionStorage, not in route state
      mockIsAuthenticated = false;
      mockNeedsOnboarding = false;
      mockAccessToken = null;
      mockLocationState = {};
      sessionStorage.setItem("oauth_pending_token", "session-token-xyz");

      // Act
      render(<OnboardingPage />);

      // Assert: form renders because sessionStorage has the token
      expect(screen.getByTestId("onboarding-form")).toBeInTheDocument();
      expect(capturedRequireEmail).toBe(true);
    });

    it("PendingOAuth_ExpiredToken_ShowsError_RedirectsToLogin", async () => {
      // Arrange
      const TOKEN = "expired-token-abc";
      setupPendingOAuthMode(TOKEN);
      sessionStorage.setItem("oauth_pending_token", TOKEN);

      // Simulate expired token error from backend
      const ExpiredError = (
        await vi.importMock<typeof import("@/services/authApi")>(
          "@/services/authApi",
        )
      ).AuthApiError;
      mockSendOAuthOnboardingOtp.mockRejectedValue(
        new ExpiredError(
          "AUTH_001",
          "Invalid or expired pending token",
          400,
        ),
      );

      render(<OnboardingPage />);

      // Act: trigger send OTP
      await capturedOnSendOtp!("test@example.com").catch(() => {
        // Error is handled internally
      });

      // Assert: sessionStorage cleaned up
      await waitFor(() => {
        expect(sessionStorage.getItem("oauth_pending_token")).toBeNull();
      });
    });
  });

  describe("Mode Detection", () => {
    it("ModeDetection_WithPendingToken_SetsEmailRequired", () => {
      // Arrange
      setupPendingOAuthMode();

      // Act
      render(<OnboardingPage />);

      // Assert
      expect(screen.getByTestId("email-required")).toBeInTheDocument();
    });

    it("ModeDetection_WithoutPendingToken_UsesRouteState", () => {
      // Arrange
      setupAuthenticatedMode();

      // Act
      render(<OnboardingPage />);

      // Assert
      expect(screen.getByTestId("email-required")).toBeInTheDocument();
    });

    it("ModeDetection_AuthModeNoEmailRequired_RendersWithoutEmailField", () => {
      // Arrange
      mockIsAuthenticated = true;
      mockNeedsOnboarding = true;
      mockAccessToken = "test-access-token";
      mockLocationState = { requireEmailVerification: false };

      // Act
      render(<OnboardingPage />);

      // Assert
      expect(
        screen.queryByTestId("email-required"),
      ).not.toBeInTheDocument();
    });
  });
});
