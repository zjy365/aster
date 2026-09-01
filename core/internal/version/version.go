// Package version carries the sidecar's identity for API-server user agents.
package version

import "fmt"

var buildVersion = "1.0.4"

func UserAgent() string {
	return fmt.Sprintf("aster/%s", buildVersion)
}
