// SPDX-License-Identifier: Apache-2.0
package helm

import (
	"bufio"
	"encoding/json"
	"io"
	"strings"

	k8syaml "k8s.io/apimachinery/pkg/util/yaml"
	"sigs.k8s.io/yaml"
)

// redactManifest masks the data of every Secret document in a rendered
// manifest. Non-Secret documents pass through byte-for-byte so users keep
// reading the exact output the chart produced; Secret documents are rebuilt
// from their parsed form because the rendered values must never leave the
// core. If the document stream cannot be split, the manifest is returned
// verbatim rather than risk dropping release content.
func redactManifest(manifest string) string {
	reader := k8syaml.NewYAMLReader(bufio.NewReader(strings.NewReader(manifest)))
	var output strings.Builder
	for {
		document, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return manifest
		}
		output.WriteString(redactSecretDocument(document))
		output.WriteString("\n---\n")
	}
	return strings.TrimSuffix(output.String(), "\n---\n")
}

func redactSecretDocument(document []byte) string {
	text := string(document)
	jsonValue, err := yaml.YAMLToJSON(document)
	if err != nil {
		return text
	}
	var object map[string]any
	if err := json.Unmarshal(jsonValue, &object); err != nil {
		return text
	}
	if object["kind"] != "Secret" {
		return text
	}
	changed := false
	for _, field := range []string{"data", "stringData"} {
		values, ok := object[field].(map[string]any)
		if !ok {
			continue
		}
		for key := range values {
			values[key] = "[redacted]"
			changed = true
		}
	}
	if !changed {
		return text
	}
	cleaned, err := yaml.Marshal(object)
	if err != nil {
		return text
	}
	return string(cleaned)
}
