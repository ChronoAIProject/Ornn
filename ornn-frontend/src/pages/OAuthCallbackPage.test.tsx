/**
 * Tests for OAuthCallbackPage.
 * Covers both login flow and link-mode flow.
 * @module pages/OAuthCallbackPage.test
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { OAuthCallbackPage } from "./OAuthCallbackPage";

// --- Mocks ---

const mockNavigate = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("react-router-dom", () => ({
  useParams: () => ({ provider: "github" }),
  useSearchParams: () => [mockSearchParams],
  useNavigate: () => mockNavigate,
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

vi.mock("@/components/ui/Modal", () => ({
  Modal: ({
    isOpen,
    children,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
  }) => (isOpen ? <div data-testid="modal">{children}</div> : null),
}));

vi.mock("@/components/ui/Button", () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button onClick={onClick}>
      {children}
    </button>
  ),
}));

// Auth store mock state
const mockSetAuth = vi.fn();
const mockRefreshToken = vi.fn();
let mockAccessToken: string | null = "test-access-token";

vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      const state = {
        setAuth: mockSetAuth,
        accessToken: mockAccessToken,
        refreshToken: mockRefreshToken,
      };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({
        accessToken: mockAccessToken,
        refreshToken: mockRefreshToken,
      }),
    },
  ),
}));

const mockAddToast = vi.fn();
vi.mock("@/stores/toastStore", () => ({
  useToastStore: (selector?: (s: { addToast: Mock }) => unknown) => {
    const state = { addToast: mockAddToast };
    return selector ? selector(state) : state;
  },
}));

const mockHandleOAuthCallback = vi.fn();
const mockResolveEmailMatchLink = vi.fn();
const mockResolveEmailMatchCreateNew = vi.fn();
vi.mock("@/services/authApi", () => ({
  handleOAuthCallback: (...args: unknown[]) =>
    mockHandleOAuthCallback(...args),
  resolveEmailMatchLink: (...args: unknown[]) =>
    mockResolveEmailMatchLink(...args),
  resolveEmailMatchCreateNew: (...args: unknown[]) =>
    mockResolveEmailMatchCreateNew(...args),
}));

const mockLinkOAuthProvider = vi.fn();
vi.mock("@/services/userApi", () => ({
  linkOAuthProvider: (...args: unknown[]) => mockLinkOAuthProvider(...args),
  UserApiError: class UserApiError extends Error {
    code: string;
    statusCode: number;
    constructor(code: string, message: string, statusCode: number) {
      super(message);
      this.name = "UserApiError";
      this.code = code;
      this.statusCode = statusCode;
    }
  },
}));

// --- Helpers ---

const VALID_STATE = "test-state-123";
const VALID_CODE = "oauth-code-abc";

function setupSearchParams(code = VALID_CODE, state = VALID_STATE) {
  mockSearchParams = new URLSearchParams({ code, state });
}

function setupSessionStorage(opts: { linkMode?: boolean; state?: string } = {}) {
  sessionStorage.setItem("oauth_state", opts.state ?? VALID_STATE);
  if (opts.linkMode) {
    sessionStorage.setItem("oauth_link_mode", "true");
  }
}

// --- Tests ---

describe("OAuthCallbackPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockAccessToken = "test-access-token";
    mockSearchParams = new URLSearchParams();
  });

  describe("Link Mode", () => {
    it("LinkMode_WithValidToken_CallsLinkEndpoint", async () => {
      // Arrange
      setupSearchParams();
      setupSessionStorage({ linkMode: true });
      mockLinkOAuthProvider.mockResolvedValue({ success: true });

      // Act
      render(<OAuthCallbackPage />);

      // Assert
      await waitFor(() => {
        expect(mockLinkOAuthProvider).toHaveBeenCalledWith(
          "test-access-token",
          "github",
          { code: VALID_CODE, state: VALID_STATE },
        );
      });

      expect(mockHandleOAuthCallback).not.toHaveBeenCalled();
      expect(mockAddToast).toHaveBeenCalledWith({
        type: "success",
        message: "Github account linked successfully",
      });
      expect(mockNavigate).toHaveBeenCalledWith("/settings", {
        replace: true,
      });
    });

    it("LinkMode_WithExpiredToken_RefreshesAndLinks", async () => {
      // Arrange
      setupSearchParams();
      setupSessionStorage({ linkMode: true });
      mockAccessToken = null;
      mockRefreshToken.mockImplementation(async () => {
        // Simulate refresh setting a new token
        mockAccessToken = "refreshed-token";
        return true;
      });
      mockLinkOAuthProvider.mockResolvedValue({ success: true });

      // Act
      render(<OAuthCallbackPage />);

      // Assert
      await waitFor(() => {
        expect(mockRefreshToken).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(mockLinkOAuthProvider).toHaveBeenCalledWith(
          "refreshed-token",
          "github",
          { code: VALID_CODE, state: VALID_STATE },
        );
      });

      expect(mockHandleOAuthCallback).not.toHaveBeenCalled();
    });

    it("LinkMode_WithExpiredTokenAndFailedRefresh_ShowsSessionExpiredError", async () => {
      // Arrange
      setupSearchParams();
      setupSessionStorage({ linkMode: true });
      mockAccessToken = null;
      mockRefreshToken.mockResolvedValue(false);

      // Act
      render(<OAuthCallbackPage />);

      // Assert
      await waitFor(() => {
        expect(
          screen.getByText(
            "Your session expired. Please sign in and try again.",
          ),
        ).toBeInTheDocument();
      });

      expect(mockLinkOAuthProvider).not.toHaveBeenCalled();
      expect(mockHandleOAuthCallback).not.toHaveBeenCalled();
    });

    it("LinkMode_WithConflictError_ShowsErrorMessage", async () => {
      // Arrange
      setupSearchParams();
      setupSessionStorage({ linkMode: true });
      mockLinkOAuthProvider.mockRejectedValue(
        new Error("This GitHub account is already linked to another user"),
      );

      // Act
      render(<OAuthCallbackPage />);

      // Assert
      await waitFor(() => {
        expect(
          screen.getByText(
            "This GitHub account is already linked to another user",
          ),
        ).toBeInTheDocument();
      });

      expect(screen.getByText("Linking Failed")).toBeInTheDocument();
    });

    it("LinkMode_CleansUpSessionStorage", async () => {
      // Arrange
      setupSearchParams();
      setupSessionStorage({ linkMode: true });
      mockLinkOAuthProvider.mockResolvedValue({ success: true });

      // Act
      render(<OAuthCallbackPage />);

      // Assert
      await waitFor(() => {
        expect(mockLinkOAuthProvider).toHaveBeenCalled();
      });

      expect(sessionStorage.getItem("oauth_link_mode")).toBeNull();
    });

    it("LinkMode_OnFailure_CleansUpSessionStorage", async () => {
      // Arrange
      setupSearchParams();
      setupSessionStorage({ linkMode: true });
      mockLinkOAuthProvider.mockRejectedValue(new Error("Link failed"));

      // Act
      render(<OAuthCallbackPage />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText("Link failed")).toBeInTheDocument();
      });

      expect(sessionStorage.getItem("oauth_link_mode")).toBeNull();
    });

    it("LinkMode_ErrorState_ShowsBackToSettings", async () => {
      // Arrange
      setupSearchParams();
      setupSessionStorage({ linkMode: true });
      mockLinkOAuthProvider.mockRejectedValue(
        new Error("Failed to link account"),
      );

      // Act
      render(<OAuthCallbackPage />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText("Back to Settings")).toBeInTheDocument();
      });

      // Verify it does NOT show "Back to Login"
      expect(screen.queryByText("Back to Login")).not.toBeInTheDocument();
    });
  });

  describe("Login Mode", () => {
    it("LoginMode_WithoutLinkFlag_CallsLoginEndpoint", async () => {
      // Arrange
      setupSearchParams();
      setupSessionStorage({ linkMode: false });
      mockHandleOAuthCallback.mockResolvedValue({
        accessToken: "new-token",
        user: { id: "1", primaryEmail: "test@example.com" },
        isNewUser: false,
        emailMatch: false,
      });

      // Act
      render(<OAuthCallbackPage />);

      // Assert
      await waitFor(() => {
        expect(mockHandleOAuthCallback).toHaveBeenCalledWith("github", {
          code: VALID_CODE,
          state: VALID_STATE,
        });
      });

      expect(mockLinkOAuthProvider).not.toHaveBeenCalled();
      expect(mockSetAuth).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
    });

    it("LoginMode_LoginError_ShowsBackToLogin", async () => {
      // Arrange
      setupSearchParams();
      setupSessionStorage({ linkMode: false });
      mockHandleOAuthCallback.mockRejectedValue(
        new Error("OAuth authentication failed"),
      );

      // Act
      render(<OAuthCallbackPage />);

      // Assert
      await waitFor(() => {
        expect(
          screen.getByText("OAuth authentication failed"),
        ).toBeInTheDocument();
      });

      expect(screen.getByText("Authentication Failed")).toBeInTheDocument();
      expect(screen.getByText("Back to Login")).toBeInTheDocument();
      expect(screen.queryByText("Back to Settings")).not.toBeInTheDocument();
    });

    it("LoginMode_NewUserWithoutEmailMatch_NavigatesToOnboarding", async () => {
      // Arrange
      setupSearchParams();
      setupSessionStorage({ linkMode: false });
      mockHandleOAuthCallback.mockResolvedValue({
        accessToken: "new-token",
        user: { id: "1", primaryEmail: "new@example.com" },
        isNewUser: true,
        emailMatch: false,
      });

      // Act
      render(<OAuthCallbackPage />);

      // Assert
      await waitFor(() => {
        expect(mockSetAuth).toHaveBeenCalledWith(
          "new-token",
          { id: "1", primaryEmail: "new@example.com" },
          true,
        );
      });

      expect(mockNavigate).toHaveBeenCalledWith("/onboarding", {
        replace: true,
        state: { requireEmailVerification: true },
      });
    });

    it("LoginMode_DeferredNewUser_DoesNotCallSetAuth_NavigatesToOnboarding", async () => {
      // Arrange: backend returns pendingOAuthToken with no user/tokens (deferred creation)
      const DEFERRED_TOKEN = "deferred-pending-token-xyz";
      setupSearchParams();
      setupSessionStorage({ linkMode: false });
      mockHandleOAuthCallback.mockResolvedValue({
        accessToken: "",
        user: null,
        isNewUser: true,
        emailMatch: false,
        pendingOAuthToken: DEFERRED_TOKEN,
      });

      // Act
      render(<OAuthCallbackPage />);

      // Assert
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith("/onboarding", {
          replace: true,
          state: {
            requireEmailVerification: true,
            pendingOAuthToken: DEFERRED_TOKEN,
          },
        });
      });

      expect(mockSetAuth).not.toHaveBeenCalled();
      expect(sessionStorage.getItem("oauth_pending_token")).toBe(DEFERRED_TOKEN);
    });
  });

  describe("Email Match Flow", () => {
    const PENDING_TOKEN = "pending-token-abc123";
    const MATCHED_EMAIL = "existing@example.com";

    function setupEmailMatchResponse() {
      mockHandleOAuthCallback.mockResolvedValue({
        accessToken: "",
        user: null,
        isNewUser: true,
        emailMatch: true,
        matchedEmail: MATCHED_EMAIL,
        pendingOAuthToken: PENDING_TOKEN,
      });
    }

    it("EmailMatch_DisplaysMatchedEmail_NotPlaceholder", async () => {
      // Arrange
      setupSearchParams();
      setupSessionStorage({ linkMode: false });
      setupEmailMatchResponse();

      // Act
      render(<OAuthCallbackPage />);

      // Assert: modal shows with the REAL matched email
      await waitFor(() => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      });

      expect(screen.getByText(MATCHED_EMAIL)).toBeInTheDocument();
      // Verify setAuth was NOT called (no user/tokens yet)
      expect(mockSetAuth).not.toHaveBeenCalled();
    });

    it("EmailMatch_StoresPendingToken_InSessionStorage", async () => {
      // Arrange
      setupSearchParams();
      setupSessionStorage({ linkMode: false });
      setupEmailMatchResponse();

      // Act
      render(<OAuthCallbackPage />);

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      });

      expect(sessionStorage.getItem("oauth_pending_token")).toBe(PENDING_TOKEN);
      // Verify old key is NOT used
      expect(sessionStorage.getItem("oauth_pending_result")).toBeNull();
    });

    it("EmailMatch_LinkAccount_CallsResolutionEndpoint", async () => {
      // Arrange
      setupSearchParams();
      setupSessionStorage({ linkMode: false });
      setupEmailMatchResponse();

      const linkedUser = {
        id: "existing-1",
        primaryEmail: MATCHED_EMAIL,
        displayName: "Existing User",
        avatarUrl: null,
        role: "member",
      };
      mockResolveEmailMatchLink.mockResolvedValue({
        accessToken: "linked-token",
        user: linkedUser,
        isNewUser: false,
      });

      // Act
      render(<OAuthCallbackPage />);

      await waitFor(() => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      });

      // Click "Link to Existing Account"
      fireEvent.click(screen.getByText("Link to Existing Account"));

      // Assert
      await waitFor(() => {
        expect(mockResolveEmailMatchLink).toHaveBeenCalledWith({
          pendingOAuthToken: PENDING_TOKEN,
        });
      });

      expect(mockSetAuth).toHaveBeenCalledWith("linked-token", linkedUser, false);
      expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
      // Token should be cleaned from sessionStorage
      expect(sessionStorage.getItem("oauth_pending_token")).toBeNull();
    });

    it("EmailMatch_CreateNew_DeferredCreation_NavigatesToOnboarding", async () => {
      // Arrange
      const NEW_PENDING_TOKEN = "new-deferred-token-456";
      setupSearchParams();
      setupSessionStorage({ linkMode: false });
      setupEmailMatchResponse();

      // Backend now returns a new pendingOAuthToken with no user/tokens (deferred)
      mockResolveEmailMatchCreateNew.mockResolvedValue({
        accessToken: "",
        user: null,
        isNewUser: true,
        pendingOAuthToken: NEW_PENDING_TOKEN,
      });

      // Act
      render(<OAuthCallbackPage />);

      await waitFor(() => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      });

      // Click "Create New Account"
      fireEvent.click(screen.getByText("Create New Account"));

      // Assert
      await waitFor(() => {
        expect(mockResolveEmailMatchCreateNew).toHaveBeenCalledWith({
          pendingOAuthToken: PENDING_TOKEN,
        });
      });

      // setAuth should NOT be called (deferred creation -- no user or tokens yet)
      expect(mockSetAuth).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith("/onboarding", {
        replace: true,
        state: {
          requireEmailVerification: true,
          pendingOAuthToken: NEW_PENDING_TOKEN,
        },
      });
      // New token should be stored in sessionStorage
      expect(sessionStorage.getItem("oauth_pending_token")).toBe(NEW_PENDING_TOKEN);
    });

    it("EmailMatch_LinkAccount_OnError_ShowsErrorState", async () => {
      // Arrange
      setupSearchParams();
      setupSessionStorage({ linkMode: false });
      setupEmailMatchResponse();
      mockResolveEmailMatchLink.mockRejectedValue(
        new Error("Invalid or expired pending token"),
      );

      // Act
      render(<OAuthCallbackPage />);

      await waitFor(() => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Link to Existing Account"));

      // Assert
      await waitFor(() => {
        expect(
          screen.getByText("Invalid or expired pending token"),
        ).toBeInTheDocument();
      });

      expect(screen.getByText("Authentication Failed")).toBeInTheDocument();
    });

    it("EmailMatch_CreateNew_OnError_ShowsErrorState", async () => {
      // Arrange
      setupSearchParams();
      setupSessionStorage({ linkMode: false });
      setupEmailMatchResponse();
      mockResolveEmailMatchCreateNew.mockRejectedValue(
        new Error("Invalid or expired pending token"),
      );

      // Act
      render(<OAuthCallbackPage />);

      await waitFor(() => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Create New Account"));

      // Assert
      await waitFor(() => {
        expect(
          screen.getByText("Invalid or expired pending token"),
        ).toBeInTheDocument();
      });

      expect(screen.getByText("Authentication Failed")).toBeInTheDocument();
    });

    it("EmailMatch_NoTokensIssuedOnInitialCallback", async () => {
      // Arrange
      setupSearchParams();
      setupSessionStorage({ linkMode: false });
      setupEmailMatchResponse();

      // Act
      render(<OAuthCallbackPage />);

      // Assert: setAuth should NOT be called during the initial callback
      await waitFor(() => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      });

      expect(mockSetAuth).not.toHaveBeenCalled();
    });
  });
});
